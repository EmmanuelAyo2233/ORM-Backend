const db = require('../db');
const bcrypt = require('bcryptjs');

// Create user account (Admin only)
exports.createUser = async (req, res) => {
  let { username, password, role, name, gender, class: studentClass, DOB, email, studentID, studentIDs } = req.body;

  if (!username && email) {
    username = email;
  }

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Please provide username, password, and role.' });
  }

  const validRoles = ['Admin', 'Teacher', 'Student', 'Parent'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  // If role is Student or Parent, require name
  if ((role === 'Student' || role === 'Parent') && !name) {
    return res.status(400).json({ error: `Name is required for role: ${role}` });
  }

  if (role === 'Student' && !studentClass) {
    return res.status(400).json({ error: 'Class is required for student role.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Check if user already exists
    const [existing] = await connection.query('SELECT userID FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Username is already taken.' });
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Insert user login record
    const [userResult] = await connection.query(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashedPassword, role]
    );
    const newUserID = userResult.insertId;

    // 4. Insert secondary metadata if Student, Parent or Teacher
    if (role === 'Student') {
      await connection.query(
        'INSERT INTO students (name, gender, class, DOB, userID) VALUES (?, ?, ?, ?, ?)',
        [name, gender || null, studentClass, DOB || null, newUserID]
      );
    } else if (role === 'Parent') {
      // Resolve list of children: prefer studentIDs array, fallback to single studentID
      const childIDs = Array.isArray(studentIDs) && studentIDs.length > 0
        ? studentIDs.map(id => parseInt(id)).filter(Boolean)
        : (studentID ? [parseInt(studentID)] : []);
      const primaryChildID = childIDs.length > 0 ? childIDs[0] : null;

      const [parentResult] = await connection.query(
        'INSERT INTO parents (name, email, userID, studentID) VALUES (?, ?, ?, ?)',
        [name, email || null, newUserID, primaryChildID]
      );
      const newParentID = parentResult.insertId;

      // Insert all child links into parent_students junction table
      for (const cid of childIDs) {
        await connection.query(
          'INSERT IGNORE INTO parent_students (parentID, studentID) VALUES (?, ?)',
          [newParentID, cid]
        );
      }
    } else if (role === 'Teacher') {
      await connection.query(
        'INSERT INTO teachers (name, userID) VALUES (?, ?)',
        [name || username, newUserID]
      );
    }

    await connection.commit();
    res.status(201).json({
      message: `${role} user created successfully.`,
      user: {
        userID: newUserID,
        username,
        role
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('[User] Create user transaction error:', error.message);
    res.status(500).json({ error: 'Server error during user account creation.' });
  } finally {
    connection.release();
  }
};

// Retrieve all user accounts (Admin only)
exports.getUsers = async (req, res) => {
  const { role, username } = req.query;
  let sql = 'SELECT userID, username, role, avatar, createdAt FROM users WHERE 1=1';
  const params = [];

  if (role) {
    sql += ' AND role = ?';
    params.push(role);
  }
  if (username) {
    sql += ' AND username LIKE ?';
    params.push(`%${username}%`);
  }

  sql += ' ORDER BY userID DESC';

  try {
    const [users] = await db.query(sql, params);
    
    // Supplement with detailed profiles
    const usersWithDetails = await Promise.all(users.map(async (user) => {
      let details = { ...user };
      if (user.role === 'Student') {
        const [students] = await db.query('SELECT studentID, name, class, gender, DOB FROM students WHERE userID = ?', [user.userID]);
        details.profile = students[0] || null;
      } else if (user.role === 'Parent') {
        const [parents] = await db.query('SELECT parentID, name, email, studentID FROM parents WHERE userID = ?', [user.userID]);
        details.profile = parents[0] || null;
      } else if (user.role === 'Teacher') {
        const [teachers] = await db.query('SELECT name FROM teachers WHERE userID = ?', [user.userID]);
        details.profile = teachers[0] || null;
      }
      return details;
    }));

    res.status(200).json(usersWithDetails);
  } catch (error) {
    console.error('[User] Get users error:', error.message);
    res.status(500).json({ error: 'Server error during users retrieval.' });
  }
};

// Update user profile (Admin only)
exports.updateUser = async (req, res) => {
  const { id } = req.params;
  let { username, password, name, gender, class: studentClass, DOB, email, studentID, studentIDs, assignments, avatar } = req.body;

  // Security check: Only Admin can update other users. Non-Admins can only update their own profile.
  if (req.user.role !== 'Admin' && req.user.userID !== parseInt(id)) {
    return res.status(403).json({ error: 'Forbidden. You do not have permission to update this user.' });
  }

  if (!username && email) {
    username = email;
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verify user exists
    const [users] = await connection.query('SELECT userID, role FROM users WHERE userID = ?', [id]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = users[0];

    // 1. Update basic credentials if provided
    if (username) {
      // Check if username taken by another user
      const [existing] = await connection.query('SELECT userID FROM users WHERE username = ? AND userID != ?', [username, id]);
      if (existing.length > 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Username is already taken.' });
      }
      await connection.query('UPDATE users SET username = ? WHERE userID = ?', [username, id]);
    }

    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      await connection.query('UPDATE users SET password = ? WHERE userID = ?', [hashedPassword, id]);
    }

    if (avatar !== undefined) {
      await connection.query('UPDATE users SET avatar = ? WHERE userID = ?', [avatar, id]);
    }

    // 2. Update role-specific profile details
    if (user.role === 'Student') {
      const updates = [];
      const values = [];
      if (name) { updates.push('name = ?'); values.push(name); }
      if (gender) { updates.push('gender = ?'); values.push(gender); }
      if (studentClass) { updates.push('class = ?'); values.push(studentClass); }
      if (DOB) { updates.push('DOB = ?'); values.push(DOB); }

      if (updates.length > 0) {
        values.push(id);
        await connection.query(`UPDATE students SET ${updates.join(', ')} WHERE userID = ?`, values);
      }
    } else if (user.role === 'Parent') {
      const updates = [];
      const values = [];
      if (name) { updates.push('name = ?'); values.push(name); }
      if (email) { updates.push('email = ?'); values.push(email); }

      // Resolve list of children
      let childIDs = [];
      if (Array.isArray(studentIDs) && studentIDs.length > 0) {
        childIDs = studentIDs.map(cid => parseInt(cid)).filter(Boolean);
      } else if (studentID !== undefined && studentID !== null && studentID !== '') {
        childIDs = [parseInt(studentID)];
      }

      if (childIDs.length > 0) {
        updates.push('studentID = ?');
        values.push(childIDs[0]); // keep legacy single column in sync
      } else if (studentID === '' || studentID === null) {
        updates.push('studentID = ?');
        values.push(null);
      }

      if (updates.length > 0) {
        values.push(id);
        await connection.query(`UPDATE parents SET ${updates.join(', ')} WHERE userID = ?`, values);
      }

      // Rebuild parent_students junction table links
      if (studentIDs !== undefined || studentID !== undefined) {
        const [parentRow] = await connection.query('SELECT parentID FROM parents WHERE userID = ?', [id]);
        if (parentRow.length > 0) {
          const parentID = parentRow[0].parentID;
          await connection.query('DELETE FROM parent_students WHERE parentID = ?', [parentID]);
          for (const cid of childIDs) {
            await connection.query(
              'INSERT IGNORE INTO parent_students (parentID, studentID) VALUES (?, ?)',
              [parentID, cid]
            );
          }
        }
      }
    } else if (user.role === 'Teacher') {
      if (name) {
        await connection.query(
          'INSERT INTO teachers (name, userID) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
          [name, id]
        );
      }
      if (assignments && Array.isArray(assignments)) {
        await connection.query('DELETE FROM teacher_assignments WHERE teacherID = ?', [id]);
        for (const ass of assignments) {
          if (ass.class && ass.subjectID) {
            await connection.query(
              'INSERT INTO teacher_assignments (teacherID, subjectID, class) VALUES (?, ?, ?)',
              [id, parseInt(ass.subjectID), ass.class]
            );
          }
        }
      }
    }

    await connection.commit();
    res.status(200).json({ message: 'User updated successfully.' });
  } catch (error) {
    await connection.rollback();
    console.error('[User] Update user transaction error:', error.code, error.sqlMessage || error.message);
    res.status(500).json({ error: 'Server error during user profile modification.', detail: error.message });
  } finally {
    connection.release();
  }
};

// Delete user account (Admin only)
exports.deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    // Check if user is trying to delete themselves
    if (parseInt(id) === req.user.userID) {
      return res.status(400).json({ error: 'You cannot deactivate or delete your own active Admin session.' });
    }

    // We can delete directly from users, since references in students and parents tables are FOREIGN KEY ON DELETE SET NULL.
    // However, if we want to delete their students/parents record fully, let's clean them up first!
    const [user] = await db.query('SELECT role FROM users WHERE userID = ?', [id]);
    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const userRole = user[0].role;
    
    if (userRole === 'Student') {
      await db.query('DELETE FROM students WHERE userID = ?', [id]);
    } else if (userRole === 'Parent') {
      await db.query('DELETE FROM parents WHERE userID = ?', [id]);
    } else if (userRole === 'Teacher') {
      await db.query('DELETE FROM teachers WHERE userID = ?', [id]);
    }

    await db.query('DELETE FROM users WHERE userID = ?', [id]);

    res.status(200).json({ message: 'User account and associated profile deleted successfully.' });
  } catch (error) {
    console.error('[User] Delete user error:', error.message);
    res.status(500).json({ error: 'Server error during user profile deletion.' });
  }
};

// --- Custom list endpoints for frontend dashboard alignment ---

exports.getStudentsList = async (req, res) => {
  try {
    const query = `
      SELECT 
        s.userID as id, 
        s.userID, 
        s.studentID, 
        s.name, 
        s.class, 
        s.gender, 
        s.DOB, 
        u.username as email, 
        u.avatar as avatar,
        u.createdAt as created_at
      FROM students s
      JOIN users u ON s.userID = u.userID
      ORDER BY s.name ASC
    `;
    const [rows] = await db.query(query);
    res.status(200).json(rows);
  } catch (error) {
    console.error('[User] Get students list error:', error.message);
    res.status(500).json({ error: 'Server error during students retrieval.' });
  }
};

exports.getTeachersList = async (req, res) => {
  try {
    const query = `
      SELECT 
        u.userID as id,
        u.userID,
        COALESCE(t.name, u.username) as name,
        u.username as email,
        u.avatar as avatar,
        u.createdAt as created_at,
        GROUP_CONCAT(DISTINCT s.subjectName ORDER BY s.subjectName SEPARATOR ', ') as subjects,
        GROUP_CONCAT(DISTINCT ta.class ORDER BY ta.class SEPARATOR ', ') as classes
      FROM users u
      LEFT JOIN teachers t ON u.userID = t.userID
      LEFT JOIN teacher_assignments ta ON u.userID = ta.teacherID
      LEFT JOIN subjects s ON ta.subjectID = s.subjectID
      WHERE u.role = 'Teacher'
      GROUP BY u.userID, t.name, u.username, u.createdAt
      ORDER BY COALESCE(t.name, u.username) ASC
    `;
    const [rows] = await db.query(query);
    res.status(200).json(rows);
  } catch (error) {
    console.error('[User] Get teachers list error:', error.message);
    res.status(500).json({ error: 'Server error during teachers retrieval.' });
  }
};

exports.getParentsList = async (req, res) => {
  try {
    const query = `
      SELECT 
        p.userID as id, 
        p.userID, 
        p.parentID, 
        p.name, 
        p.email, 
        p.studentID, 
        u.avatar as avatar,
        u.createdAt as created_at,
        GROUP_CONCAT(DISTINCT ps.studentID ORDER BY ps.studentID SEPARATOR ',') as studentIDs
      FROM parents p
      LEFT JOIN users u ON p.userID = u.userID
      LEFT JOIN parent_students ps ON p.parentID = ps.parentID
      GROUP BY p.userID, p.parentID, p.name, p.email, p.studentID, u.avatar, u.createdAt
      ORDER BY p.name ASC
    `;
    const [rows] = await db.query(query);
    // Parse studentIDs into an array
    const parsed = rows.map(r => ({
      ...r,
      studentIDs: r.studentIDs ? r.studentIDs.split(',').map(Number) : (r.studentID ? [r.studentID] : [])
    }));
    res.status(200).json(parsed);
  } catch (error) {
    console.error('[User] Get parents list error:', error.message);
    res.status(500).json({ error: 'Server error during parents retrieval.' });
  }
};

// Promote a student to the next class in sequence (Admin only)
exports.promoteStudent = async (req, res) => {
  const { id } = req.params; // studentID
  const CLASS_ORDER = ['JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'];

  try {
    const [students] = await db.query(
      'SELECT studentID, name, class FROM students WHERE studentID = ?',
      [id]
    );
    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }

    const student = students[0];
    const currentIdx = CLASS_ORDER.indexOf(student.class);

    if (currentIdx === -1) {
      return res.status(400).json({ error: `Current class "${student.class}" is not in the standard promotion sequence.` });
    }
    if (currentIdx === CLASS_ORDER.length - 1) {
      return res.status(400).json({ error: `${student.name} is already in the final class (SSS 3) and cannot be promoted further.` });
    }

    const nextClass = CLASS_ORDER[currentIdx + 1];
    await db.query('UPDATE students SET class = ? WHERE studentID = ?', [nextClass, id]);

    res.status(200).json({
      message: `${student.name} has been promoted from ${student.class} to ${nextClass}.`,
      newClass: nextClass
    });
  } catch (error) {
    console.error('[User] Promote student error:', error.message);
    res.status(500).json({ error: 'Server error during student promotion.' });
  }
};
