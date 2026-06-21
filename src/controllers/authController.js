const db = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

exports.login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Please provide both username and password.' });
  }

  try {
    // Check if user exists
    const [users] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (users.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const user = users[0];

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Sign JWT Token
    const payload = {
      userID: user.userID,
      username: user.username,
      role: user.role
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET || 'supersecretjwtkey123!@#',
      { expiresIn: '24h' }
    );

    res.status(200).json({
      message: 'Login successful.',
      token,
      user: {
        userID: user.userID,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Server error during login processing.' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const [users] = await db.query('SELECT userID, username, role FROM users WHERE userID = ?', [req.user.userID]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    const user = users[0];
    
    // Retrieve additional information if user is a student or parent
    let profileData = { ...user };
    
    if (user.role === 'Student') {
      const [students] = await db.query('SELECT * FROM students WHERE userID = ?', [user.userID]);
      if (students.length > 0) {
        profileData.studentInfo = students[0];
      }
    } else if (user.role === 'Parent') {
      const [parents] = await db.query('SELECT * FROM parents WHERE userID = ?', [user.userID]);
      if (parents.length > 0) {
        profileData.parentInfo = parents[0];
      }
    } else if (user.role === 'Teacher') {
      const [teachers] = await db.query('SELECT * FROM teachers WHERE userID = ?', [user.userID]);
      if (teachers.length > 0) {
        profileData.teacherInfo = teachers[0];
      }
    }

    res.status(200).json(profileData);
  } catch (error) {
    console.error('[Auth] Profile fetching error:', error.message);
    res.status(500).json({ error: 'Server error during profile retrieval.' });
  }
};
