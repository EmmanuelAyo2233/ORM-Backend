const db = require('../db');

// --- Subject Management ---

exports.createSubject = async (req, res) => {
  const { subjectName } = req.body;
  if (!subjectName) {
    return res.status(400).json({ error: 'Please provide a subject name.' });
  }

  try {
    const [result] = await db.query('INSERT INTO subjects (subjectName) VALUES (?)', [subjectName]);
    res.status(201).json({
      message: 'Subject created successfully.',
      subject: {
        subjectID: result.insertId,
        subjectName
      }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Subject with this name already exists.' });
    }
    console.error('[Academic] Create subject error:', error.message);
    res.status(500).json({ error: 'Server error during subject creation.' });
  }
};

exports.getSubjects = async (req, res) => {
  try {
    const [subjects] = await db.query('SELECT * FROM subjects ORDER BY subjectName ASC');
    res.status(200).json(subjects);
  } catch (error) {
    console.error('[Academic] Get subjects error:', error.message);
    res.status(500).json({ error: 'Server error during subjects retrieval.' });
  }
};

exports.deleteSubject = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM subjects WHERE subjectID = ?', [id]);
    res.status(200).json({ message: 'Subject deleted successfully.' });
  } catch (error) {
    console.error('[Academic] Delete subject error:', error.message);
    res.status(500).json({ error: 'Server error during subject deletion.' });
  }
};

// --- Default Data ---
const DEFAULT_CLASSES = ['JSS 1', 'JSS 2', 'JSS 3', 'SSS 1', 'SSS 2', 'SSS 3'];

const DEFAULT_SUBJECTS = [
  'Mathematics', 'English Language', 'Physics', 'Chemistry', 'Biology',
  'Geography', 'History', 'Economics', 'Government', 'Literature in English',
  'Agricultural Science', 'Civic Education', 'Computer Science', 'Further Mathematics',
  'Technical Drawing', 'French', 'Fine Art', 'Physical Education', 'Health Education',
  'Home Economics', 'Basic Science', 'Basic Technology', 'Social Studies', 'CRS/IRS'
];

// Initialize default subjects and classes (called by admin)
exports.seedDefaults = async (req, res) => {
  try {
    // Ensure classes table exists first
    await db.query(`
      CREATE TABLE IF NOT EXISTS classes (
        classID INT AUTO_INCREMENT PRIMARY KEY,
        className VARCHAR(50) NOT NULL UNIQUE
      )
    `);

    // Seed subjects
    for (const sub of DEFAULT_SUBJECTS) {
      await db.query('INSERT IGNORE INTO subjects (subjectName) VALUES (?)', [sub]);
    }
    // Seed classes
    for (const cls of DEFAULT_CLASSES) {
      await db.query('INSERT IGNORE INTO classes (className) VALUES (?)', [cls]);
    }
    res.status(200).json({ message: 'Default subjects and classes initialized successfully.' });
  } catch (error) {
    console.error('[Academic] Seed defaults error:', error.message);
    res.status(500).json({ error: 'Server error during initialization.' });
  }
};

// --- Class Management ---

exports.getClasses = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT classID, className FROM classes ORDER BY classID ASC');
    if (rows.length === 0) {
      return res.status(200).json(DEFAULT_CLASSES.map((c, i) => ({ classID: i + 1, className: c })));
    }
    res.status(200).json(rows);
  } catch (error) {
    // classes table may not exist yet — return safe defaults
    res.status(200).json(DEFAULT_CLASSES.map((c, i) => ({ classID: i + 1, className: c })));
  }
};

exports.createClass = async (req, res) => {
  const { className } = req.body;
  if (!className) {
    return res.status(400).json({ error: 'Please provide a class name.' });
  }
  try {
    const [result] = await db.query('INSERT INTO classes (className) VALUES (?)', [className]);
    res.status(201).json({ message: 'Class created.', class: { classID: result.insertId, className } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'A class with this name already exists.' });
    }
    console.error('[Academic] Create class error:', error.message);
    res.status(500).json({ error: 'Server error during class creation.' });
  }
};

exports.deleteClass = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM classes WHERE classID = ?', [id]);
    res.status(200).json({ message: 'Class deleted successfully.' });
  } catch (error) {
    console.error('[Academic] Delete class error:', error.message);
    res.status(500).json({ error: 'Server error during class deletion.' });
  }
};

// --- Teacher Assignment Management (Linking teachers to subject and class) ---

exports.createAssignment = async (req, res) => {
  const { teacherID, subjectID, class: className } = req.body;

  if (!teacherID || !subjectID || !className) {
    return res.status(400).json({ error: 'Please provide teacherID, subjectID, and class.' });
  }

  try {
    // 1. Verify user is a Teacher
    const [user] = await db.query('SELECT role FROM users WHERE userID = ?', [teacherID]);
    if (user.length === 0 || user[0].role !== 'Teacher') {
      return res.status(400).json({ error: 'The specified user is not a registered Teacher.' });
    }

    // 2. Verify subject exists
    const [sub] = await db.query('SELECT subjectID FROM subjects WHERE subjectID = ?', [subjectID]);
    if (sub.length === 0) {
      return res.status(400).json({ error: 'Subject does not exist.' });
    }

    // 3. Insert assignment
    const [result] = await db.query(
      'INSERT INTO teacher_assignments (teacherID, subjectID, class) VALUES (?, ?, ?)',
      [teacherID, subjectID, className]
    );

    res.status(201).json({
      message: 'Teacher assignment created successfully.',
      assignment: {
        assignmentID: result.insertId,
        teacherID,
        subjectID,
        class: className
      }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'This assignment details already exist.' });
    }
    console.error('[Academic] Create assignment error:', error.message);
    res.status(500).json({ error: 'Server error during assignment mapping.' });
  }
};

exports.getAssignments = async (req, res) => {
  try {
    const queryStr = `
      SELECT 
        ta.assignmentID, 
        ta.class, 
        ta.teacherID, 
        ta.subjectID,
        u.username as teacherName,
        s.subjectName
      FROM teacher_assignments ta
      JOIN users u ON ta.teacherID = u.userID
      JOIN subjects s ON ta.subjectID = s.subjectID
      ORDER BY ta.class ASC, s.subjectName ASC
    `;
    const [assignments] = await db.query(queryStr);
    res.status(200).json(assignments);
  } catch (error) {
    console.error('[Academic] Get assignments error:', error.message);
    res.status(500).json({ error: 'Server error during assignments retrieval.' });
  }
};

exports.deleteAssignment = async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM teacher_assignments WHERE assignmentID = ?', [id]);
    res.status(200).json({ message: 'Assignment deleted successfully.' });
  } catch (error) {
    console.error('[Academic] Delete assignment error:', error.message);
    res.status(500).json({ error: 'Server error during assignment deletion.' });
  }
};
