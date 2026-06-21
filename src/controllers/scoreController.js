const db = require('../db');
const { calculateGrade, calculateRemark, calculateClassPositions } = require('../utils/gradingEngine');

// Helper to calculate overall class position for a student in a class & session based on average total score of approved results
const calculateOverallClassPosition = async (className, session_id, studentID) => {
  try {
    // 1. Get all students in this class
    const [studentsInClass] = await db.query(
      'SELECT studentID FROM students WHERE class = ?',
      [className]
    );
    if (studentsInClass.length === 0) return { position: 'N/A', classSize: 0 };

    const studentIDs = studentsInClass.map(s => s.studentID);

    // 2. Get the average score across all subjects for each student in this class for the given session_id (approved only)
    const [results] = await db.query(
      `SELECT studentID, AVG(total) as avg_score 
       FROM results 
       WHERE session_id = ? AND status = 'approved' AND studentID IN (${studentIDs.map(() => '?').join(',')})
       GROUP BY studentID`,
      [session_id, ...studentIDs]
    );

    if (results.length === 0) return { position: 'N/A', classSize: studentIDs.length };

    // 3. Sort students by average score descending
    const ranked = results
      .map(r => ({
        studentID: r.studentID,
        avg_score: parseFloat(r.avg_score)
      }))
      .sort((a, b) => b.avg_score - a.avg_score);

    // 4. Assign ranks, handling ties
    let currentRank = 1;
    for (let i = 0; i < ranked.length; i++) {
      if (i > 0 && ranked[i].avg_score < ranked[i - 1].avg_score) {
        currentRank = i + 1;
      }
      ranked[i].position = currentRank;
    }

    // 5. Find current student's rank
    const match = ranked.find(r => r.studentID === studentID);
    return {
      position: match ? match.position : 'N/A',
      classSize: studentIDs.length
    };
  } catch (err) {
    console.error('[Scores] calculateOverallClassPosition error:', err.message);
    return { position: 'N/A', classSize: 0 };
  }
};

// --- Teacher Dashboard Operations ---

// Get classes assigned to the logged-in teacher
exports.getTeacherClasses = async (req, res) => {
  const teacherID = req.user.userID;
  try {
    const queryStr = `
      SELECT DISTINCT
        ta.class,
        ta.subjectID,
        s.subjectName
      FROM teacher_assignments ta
      JOIN subjects s ON ta.subjectID = s.subjectID
      WHERE ta.teacherID = ?
      ORDER BY ta.class ASC, s.subjectName ASC
    `;
    const [assignments] = await db.query(queryStr, [teacherID]);
    res.status(200).json(assignments);
  } catch (error) {
    console.error('[Scores] Get teacher classes error:', error.message);
    res.status(500).json({ error: 'Server error during assigned classes lookup.' });
  }
};

// Get students in a class, with any existing scores for editing
exports.getStudentsByClass = async (req, res) => {
  const { className } = req.params;
  const { subjectID, session_id } = req.query;

  if (!subjectID || !session_id) {
    return res.status(400).json({ error: 'Please specify subjectID and session_id as query params.' });
  }

  try {
    // Left join results so if student has no score yet, it returns nulls
    const queryStr = `
      SELECT 
        s.studentID,
        s.name as studentName,
        s.class,
        r.resultID,
        r.ca_score,
        r.exam_score,
        r.total,
        r.grade,
        r.remark
      FROM students s
      LEFT JOIN results r ON s.studentID = r.studentID 
        AND r.subjectID = ? 
        AND r.session_id = ?
      WHERE s.class = ?
      ORDER BY s.name ASC
    `;
    const [students] = await db.query(queryStr, [subjectID, session_id, className]);
    
    // Format results to output clean values if null
    const formatted = students.map(student => ({
      studentID: student.studentID,
      studentName: student.studentName,
      class: student.class,
      resultID: student.resultID || null,
      ca_score: student.ca_score !== null ? parseFloat(student.ca_score) : 0,
      exam_score: student.exam_score !== null ? parseFloat(student.exam_score) : 0,
      total: student.total !== null ? parseFloat(student.total) : 0,
      grade: student.grade || '',
      remark: student.remark || ''
    }));

    res.status(200).json(formatted);
  } catch (error) {
    console.error('[Scores] Get students by class error:', error.message);
    res.status(500).json({ error: 'Server error during students scorecard retrieval.' });
  }
};

// Enter / update CA + exam scores for students in batch
exports.submitScores = async (req, res) => {
  const { subjectID, session_id, scores } = req.body;

  if (!subjectID || !session_id || !Array.isArray(scores)) {
    return res.status(400).json({ error: 'Please provide subjectID, session_id, and scores list.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Check if any results are already approved and reupload not allowed
    const [approvedCheck] = await connection.query(
      `SELECT COUNT(*) as count FROM results 
       WHERE subjectID = ? AND session_id = ? AND status = 'approved' AND reupload_allowed = 0
       AND studentID IN (${scores.map(() => '?').join(',')})`,
      [subjectID, session_id, ...scores.map(s => s.studentID)]
    );
    if (approvedCheck[0].count > 0) {
      await connection.rollback();
      return res.status(403).json({ error: 'Results for this session have been approved by the Admin. Contact admin to allow reupload.', approved: true });
    }

    for (const scoreEntry of scores) {
      const { studentID, ca_score, exam_score, remark: customRemark } = scoreEntry;
      
      const ca = parseFloat(ca_score || 0);
      const exam = parseFloat(exam_score || 0);

      if (ca < 0 || ca > 40 || exam < 0 || exam > 60) {
        await connection.rollback();
        return res.status(400).json({ 
          error: `Scores boundaries exceeded for student ID ${studentID}. CA must be 0-40, Exam 0-60.` 
        });
      }

      const total = ca + exam;
      const grade = calculateGrade(total);
      const remark = customRemark !== undefined && customRemark !== null && customRemark.trim() !== '' 
        ? customRemark 
        : calculateRemark(grade);

      const insertOrUpdateStr = `
        INSERT INTO results (studentID, subjectID, ca_score, exam_score, grade, remark, session_id, status, reupload_allowed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)
        ON DUPLICATE KEY UPDATE
          ca_score = VALUES(ca_score),
          exam_score = VALUES(exam_score),
          grade = VALUES(grade),
          remark = VALUES(remark),
          status = 'pending',
          reupload_allowed = 0
      `;
      await connection.query(insertOrUpdateStr, [studentID, subjectID, ca, exam, grade, remark, session_id]);
    }

    await connection.commit();
    res.status(200).json({ message: 'Scores submitted successfully. Pending Admin approval before students can view.' });
  } catch (error) {
    await connection.rollback();
    console.error('[Scores] Submit scores transaction error:', error.message);
    res.status(500).json({ error: 'Server error during grades saving.' });
  } finally {
    connection.release();
  }
};

// --- Student / Parent View Operations ---

// Get results sheet with rankings
exports.getStudentResults = async (req, res) => {
  const { studentId } = req.params;
  const { session } = req.query;

  if (!session) {
    return res.status(400).json({ error: 'Please specify session as a query parameter.' });
  }

  try {
    // 1. Verify student exists and retrieve class details
    const [students] = await db.query('SELECT class, name FROM students WHERE studentID = ?', [studentId]);
    if (students.length === 0) {
      return res.status(404).json({ error: 'Student not found.' });
    }
    const studentClass = students[0].class;
    const studentName = students[0].name;

    // 2. Fetch all scores for this student
    const scoresQuery = `
      SELECT 
        r.resultID,
        r.subjectID,
        s.subjectName,
        r.ca_score,
        r.exam_score,
        r.total,
        r.grade,
        r.remark,
        r.session_id
      FROM results r
      JOIN subjects s ON r.subjectID = s.subjectID
      WHERE r.studentID = ? AND r.session_id = ?
      ORDER BY s.subjectName ASC
    `;
    const [studentResults] = await db.query(scoresQuery, [studentId, session]);

    // 3. For each subject the student took, calculate class position rank dynamically
    const finalResults = [];
    const overallCache = {};

    for (const result of studentResults) {
      // Get all results in the student's class for this subject and session
      const classResultsQuery = `
        SELECT 
          r.studentID,
          r.total
        FROM results r
        JOIN students s ON r.studentID = s.studentID
        WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ?
      `;
      const [classResults] = await db.query(classResultsQuery, [studentClass, result.subjectID, session]);
      
      // Calculate positions
      const rankedResults = calculateClassPositions(classResults);
      
      // Find current student's rank in this list
      const matched = rankedResults.find(r => r.studentID === parseInt(studentId));
      
      // Calculate overall class position
      if (!overallCache[result.session_id]) {
        overallCache[result.session_id] = await calculateOverallClassPosition(studentClass, result.session_id, parseInt(studentId));
      }
      const overall = overallCache[result.session_id];

      finalResults.push({
        ...result,
        total: parseFloat(result.total),
        ca_score: parseFloat(result.ca_score),
        exam_score: parseFloat(result.exam_score),
        position: matched ? matched.position : 'N/A',
        overall_class_position: overall.position,
        class_size: overall.classSize
      });
    }

    res.status(200).json({
      studentName,
      class: studentClass,
      session,
      results: finalResults
    });
  } catch (error) {
    console.error('[Scores] Get student results error:', error.message);
    res.status(500).json({ error: 'Server error during report card generation.' });
  }
};

// --- Admin Dashboard Statistics ---

exports.getDashboardStats = async (req, res) => {
  try {
    const [studentsCount] = await db.query('SELECT COUNT(*) as count FROM students');
    const [teachersCount] = await db.query('SELECT COUNT(*) as count FROM users WHERE role = "Teacher"');
    const [subjectsCount] = await db.query('SELECT COUNT(*) as count FROM subjects');
    
    // Average scores / pass rates summary
    const [gradesStats] = await db.query(`
      SELECT 
        AVG(total) as classAverage,
        SUM(CASE WHEN total >= 40 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as passRate
      FROM results
    `);

    res.status(200).json({
      totalStudents: studentsCount[0].count,
      totalTeachers: teachersCount[0].count,
      totalSubjects: subjectsCount[0].count,
      classAverage: gradesStats[0].classAverage ? parseFloat(gradesStats[0].classAverage).toFixed(2) : '0.00',
      passRate: gradesStats[0].passRate ? parseFloat(gradesStats[0].passRate).toFixed(2) : '0.00'
    });
  } catch (error) {
    console.error('[Scores] Get dashboard stats error:', error.message);
    res.status(500).json({ error: 'Server error during statistics calculation.' });
  }
};

// --- Custom result operations for frontend dashboard alignment ---

exports.submitScoresBulk = async (req, res) => {
  const { results } = req.body;

  if (!Array.isArray(results)) {
    return res.status(400).json({ error: 'Please provide results array.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    for (const entry of results) {
      const { student_id, subject_id, ca_score, exam_score, term, session, remark: customRemark } = entry;
      
      const ca = parseFloat(ca_score || 0);
      const exam = parseFloat(exam_score || 0);
      const session_id = `${session}-${term}`;

      // 1. Resolve studentID: check if student_id is a valid studentID first
      let [studentRow] = await connection.query(
        'SELECT studentID FROM students WHERE studentID = ?',
        [student_id]
      );
      // If not found, try to resolve via userID
      if (studentRow.length === 0) {
        [studentRow] = await connection.query(
          'SELECT studentID FROM students WHERE userID = ?',
          [student_id]
        );
      }
      if (studentRow.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: `Student with ID ${student_id} not found.` });
      }
      const actualStudentID = studentRow[0].studentID;

      // 2. Block reupload if results are approved
      const [approvedCheck] = await connection.query(
        `SELECT resultID FROM results WHERE studentID = ? AND subjectID = ? AND session_id = ? AND status = 'approved' AND reupload_allowed = 0`,
        [actualStudentID, subject_id, session_id]
      );
      if (approvedCheck.length > 0) {
        await connection.rollback();
        return res.status(403).json({ error: 'Results for this session have been approved by the Admin. Contact admin to allow reupload.', approved: true });
      }

      // 3. Validate scores
      if (ca < 0 || ca > 40 || exam < 0 || exam > 60) {
        await connection.rollback();
        return res.status(400).json({ error: `Score boundaries exceeded. CA must be 0-40, Exam 0-60.` });
      }

      const total = ca + exam;
      const grade = calculateGrade(total);
      const remark = customRemark !== undefined && customRemark !== null && customRemark.trim() !== '' 
        ? customRemark 
        : calculateRemark(grade);

      // 4. Save or update — always sets status to pending on new submission
      const insertOrUpdateStr = `
        INSERT INTO results (studentID, subjectID, ca_score, exam_score, grade, remark, session_id, status, reupload_allowed)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0)
        ON DUPLICATE KEY UPDATE
          ca_score = VALUES(ca_score),
          exam_score = VALUES(exam_score),
          grade = VALUES(grade),
          remark = VALUES(remark),
          status = 'pending',
          reupload_allowed = 0
      `;
      await connection.query(insertOrUpdateStr, [actualStudentID, subject_id, ca, exam, grade, remark, session_id]);
    }

    await connection.commit();
    res.status(200).json({ message: 'Scores submitted successfully. Pending Admin approval before students can view.' });
  } catch (error) {
    await connection.rollback();
    console.error('[Scores] Submit scores bulk error:', error.message);
    res.status(500).json({ error: 'Server error during grades saving.' });
  } finally {
    connection.release();
  }
};

exports.getAllResults = async (req, res) => {
  try {
    const query = `
      SELECT 
        r.resultID,
        r.studentID,
        s.name as student_name,
        s.class,
        sub.subjectID,
        sub.subjectName as subject_name,
        r.ca_score,
        r.exam_score,
        r.total as total_score,
        r.total,
        r.grade,
        r.remark,
        r.session_id,
        r.status,
        r.reupload_allowed
      FROM results r
      JOIN students s ON r.studentID = s.studentID
      JOIN subjects sub ON r.subjectID = sub.subjectID
      ORDER BY r.resultID DESC
    `;
    const [rows] = await db.query(query);

    // Calculate positions for each result row
    const cache = {};
    const finalResults = [];

    for (const row of rows) {
      const cacheKey = `${row.class}-${row.subjectID}-${row.session_id}`;
      if (!cache[cacheKey]) {
        const classResultsQuery = `
          SELECT r.studentID, r.total
          FROM results r
          JOIN students s ON r.studentID = s.studentID
          WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ?
        `;
        const [classResults] = await db.query(classResultsQuery, [row.class, row.subjectID, row.session_id]);
        cache[cacheKey] = calculateClassPositions(classResults);
      }

      const matched = cache[cacheKey].find(item => item.studentID === row.studentID);
      const parts = row.session_id.split('-');
      const term = parts[1] || '';

      finalResults.push({
        ...row,
        term,
        ca_score: parseFloat(row.ca_score),
        exam_score: parseFloat(row.exam_score),
        total_score: parseFloat(row.total_score),
        position: matched ? matched.position : 'N/A'
      });
    }

    res.status(200).json(finalResults);
  } catch (error) {
    console.error('[Scores] Get all results error:', error.message);
    res.status(500).json({ error: 'Server error during results lookup.' });
  }
};

exports.getMyResults = async (req, res) => {
  const userID = req.user.userID;
  try {
    const [studentRow] = await db.query('SELECT studentID, class FROM students WHERE userID = ?', [userID]);
    if (studentRow.length === 0) {
      return res.status(200).json([]);
    }
    const { studentID, class: studentClass } = studentRow[0];

    const query = `
      SELECT 
        r.resultID,
        r.studentID,
        sub.subjectID,
        sub.subjectName as subject_name,
        r.ca_score,
        r.exam_score,
        r.total as total_score,
        r.total,
        r.grade,
        r.remark,
        r.session_id,
        r.status
      FROM results r
      JOIN subjects sub ON r.subjectID = sub.subjectID
      WHERE r.studentID = ? AND r.status = 'approved'
      ORDER BY r.resultID DESC
    `;
    const [rows] = await db.query(query, [studentID]);

    const cache = {};
    const overallCache = {};
    const finalResults = [];

    for (const row of rows) {
      const cacheKey = `${studentClass}-${row.subjectID}-${row.session_id}`;
      if (!cache[cacheKey]) {
        const classResultsQuery = `
          SELECT r.studentID, r.total
          FROM results r
          JOIN students s ON r.studentID = s.studentID
          WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ?
        `;
        const [classResults] = await db.query(classResultsQuery, [studentClass, row.subjectID, row.session_id]);
        cache[cacheKey] = calculateClassPositions(classResults);
      }

      // Calculate overall class position
      if (!overallCache[row.session_id]) {
        overallCache[row.session_id] = await calculateOverallClassPosition(studentClass, row.session_id, studentID);
      }
      const overall = overallCache[row.session_id];

      const matched = cache[cacheKey].find(item => item.studentID === studentID);
      const parts = row.session_id.split('-');
      const term = parts[1] || '';

      finalResults.push({
        ...row,
        term,
        ca_score: parseFloat(row.ca_score),
        exam_score: parseFloat(row.exam_score),
        total_score: parseFloat(row.total_score),
        position: matched ? matched.position : 'N/A',
        overall_class_position: overall.position,
        class_size: overall.classSize
      });
    }

    res.status(200).json(finalResults);
  } catch (error) {
    console.error('[Scores] Get my results error:', error.message);
    res.status(500).json({ error: 'Server error during results query.' });
  }
};

exports.getChildResults = async (req, res) => {
  const userID = req.user.userID;
  try {
    const [parentRow] = await db.query('SELECT studentID FROM parents WHERE userID = ?', [userID]);
    if (parentRow.length === 0 || !parentRow[0].studentID) {
      return res.status(200).json([]);
    }
    const studentID = parentRow[0].studentID;

    const [studentRow] = await db.query('SELECT class FROM students WHERE studentID = ?', [studentID]);
    if (studentRow.length === 0) {
      return res.status(200).json([]);
    }
    const studentClass = studentRow[0].class;

    const query = `
      SELECT 
        r.resultID,
        r.studentID,
        sub.subjectID,
        sub.subjectName as subject_name,
        r.ca_score,
        r.exam_score,
        r.total as total_score,
        r.total,
        r.grade,
        r.remark,
        r.session_id,
        r.status
      FROM results r
      JOIN subjects sub ON r.subjectID = sub.subjectID
      WHERE r.studentID = ? AND r.status = 'approved'
      ORDER BY r.resultID DESC
    `;
    const [rows] = await db.query(query, [studentID]);

    const cache = {};
    const overallCache = {};
    const finalResults = [];

    for (const row of rows) {
      const cacheKey = `${studentClass}-${row.subjectID}-${row.session_id}`;
      if (!cache[cacheKey]) {
        const classResultsQuery = `
          SELECT r.studentID, r.total
          FROM results r
          JOIN students s ON r.studentID = s.studentID
          WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ?
        `;
        const [classResults] = await db.query(classResultsQuery, [studentClass, row.subjectID, row.session_id]);
        cache[cacheKey] = calculateClassPositions(classResults);
      }

      // Calculate overall class position
      if (!overallCache[row.session_id]) {
        overallCache[row.session_id] = await calculateOverallClassPosition(studentClass, row.session_id, studentID);
      }
      const overall = overallCache[row.session_id];

      const matched = cache[cacheKey].find(item => item.studentID === studentID);
      const parts = row.session_id.split('-');
      const term = parts[1] || '';

      finalResults.push({
        ...row,
        term,
        ca_score: parseFloat(row.ca_score),
        exam_score: parseFloat(row.exam_score),
        total_score: parseFloat(row.total_score),
        position: matched ? matched.position : 'N/A',
        overall_class_position: overall.position,
        class_size: overall.classSize
      });
    }

    res.status(200).json(finalResults);
  } catch (error) {
    console.error('[Scores] Get child results error:', error.message);
    res.status(500).json({ error: 'Server error during results query.' });
  }
};

// --- Admin Result Approval Operations ---

// Get all pending results grouped by session/subject/class for admin to review
exports.getPendingResults = async (req, res) => {
  try {
    const query = `
      SELECT 
        r.resultID,
        r.studentID,
        s.name as student_name,
        s.class,
        sub.subjectID,
        sub.subjectName as subject_name,
        r.ca_score,
        r.exam_score,
        r.total as total_score,
        r.grade,
        r.remark,
        r.session_id,
        r.status
      FROM results r
      JOIN students s ON r.studentID = s.studentID
      JOIN subjects sub ON r.subjectID = sub.subjectID
      WHERE r.status = 'pending'
      ORDER BY r.session_id DESC, s.class ASC, sub.subjectName ASC, s.name ASC
    `;
    const [rows] = await db.query(query);
    res.status(200).json(rows);
  } catch (error) {
    console.error('[Scores] Get pending results error:', error.message);
    res.status(500).json({ error: 'Server error during pending results lookup.' });
  }
};

// Approve all pending results for a given class/subject/session batch
exports.approveResults = async (req, res) => {
  const { class: className, subjectID, session_id } = req.body;
  if (!className || !subjectID || !session_id) {
    return res.status(400).json({ error: 'Please provide class, subjectID, and session_id.' });
  }
  try {
    await db.query(
      `UPDATE results r
       JOIN students s ON r.studentID = s.studentID
       SET r.status = 'approved', r.reupload_allowed = 0
       WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ? AND r.status = 'pending'`,
      [className, subjectID, session_id]
    );
    res.status(200).json({ message: 'Results approved successfully. Students can now view their results.' });
  } catch (error) {
    console.error('[Scores] Approve results error:', error.message);
    res.status(500).json({ error: 'Server error during results approval.' });
  }
};

// Allow teacher to reupload results for a given class/subject/session batch
exports.allowReupload = async (req, res) => {
  const { class: className, subjectID, session_id } = req.body;
  if (!className || !subjectID || !session_id) {
    return res.status(400).json({ error: 'Please provide class, subjectID, and session_id.' });
  }
  try {
    await db.query(
      `UPDATE results r
       JOIN students s ON r.studentID = s.studentID
       SET r.status = 'pending', r.reupload_allowed = 1
       WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ?`,
      [className, subjectID, session_id]
    );
    res.status(200).json({ message: 'Reupload allowed. Teacher can now update results for this session.' });
  } catch (error) {
    console.error('[Scores] Allow reupload error:', error.message);
    res.status(500).json({ error: 'Server error during reupload permission.' });
  }
};

// Get teacher dashboard statistics
exports.getTeacherStats = async (req, res) => {
  const teacherID = req.user.userID;
  try {
    // 1. Unique assigned classes
    const [classesRow] = await db.query(
      'SELECT COUNT(DISTINCT class) as count FROM teacher_assignments WHERE teacherID = ?',
      [teacherID]
    );

    // 2. Unique subjects taught
    const [subjectsRow] = await db.query(
      'SELECT COUNT(DISTINCT subjectID) as count FROM teacher_assignments WHERE teacherID = ?',
      [teacherID]
    );

    // 3. Total students in those assigned classes
    const [studentsRow] = await db.query(
      'SELECT COUNT(*) as count FROM students WHERE class IN (SELECT DISTINCT class FROM teacher_assignments WHERE teacherID = ?)',
      [teacherID]
    );

    // 4. Total results entered by this teacher
    const [resultsRow] = await db.query(
      `SELECT COUNT(*) as count FROM results 
       WHERE subjectID IN (SELECT DISTINCT subjectID FROM teacher_assignments WHERE teacherID = ?)
         AND studentID IN (SELECT studentID FROM students WHERE class IN (SELECT DISTINCT class FROM teacher_assignments WHERE teacherID = ?))`,
      [teacherID, teacherID]
    );

    res.status(200).json({
      classesCount: classesRow[0].count || 0,
      subjectsCount: subjectsRow[0].count || 0,
      studentsCount: studentsRow[0].count || 0,
      resultsCount: resultsRow[0].count || 0
    });
  } catch (error) {
    console.error('[Scores] Get teacher dashboard stats error:', error.message);
    res.status(500).json({ error: 'Server error during statistics calculation.' });
  }
};

// Get results submitted by the logged-in teacher
exports.getTeacherResults = async (req, res) => {
  const teacherID = req.user.userID;
  try {
    const query = `
      SELECT 
        r.resultID,
        r.studentID,
        s.name as student_name,
        s.class,
        sub.subjectID,
        sub.subjectName as subject_name,
        r.ca_score,
        r.exam_score,
        r.total as total_score,
        r.total,
        r.grade,
        r.remark,
        r.session_id,
        r.status
      FROM results r
      JOIN students s ON r.studentID = s.studentID
      JOIN subjects sub ON r.subjectID = sub.subjectID
      JOIN teacher_assignments ta ON s.class = ta.class AND r.subjectID = ta.subjectID
      WHERE ta.teacherID = ?
      ORDER BY r.resultID DESC
    `;
    const [rows] = await db.query(query, [teacherID]);

    // Calculate positions for each result row
    const cache = {};
    const finalResults = [];

    for (const row of rows) {
      const cacheKey = `${row.class}-${row.subjectID}-${row.session_id}`;
      if (!cache[cacheKey]) {
        const classResultsQuery = `
          SELECT r.studentID, r.total
          FROM results r
          JOIN students s ON r.studentID = s.studentID
          WHERE s.class = ? AND r.subjectID = ? AND r.session_id = ?
        `;
        const [classResults] = await db.query(classResultsQuery, [row.class, row.subjectID, row.session_id]);
        cache[cacheKey] = calculateClassPositions(classResults);
      }

      const matched = cache[cacheKey].find(item => item.studentID === row.studentID);
      const parts = row.session_id.split('-');
      const term = parts[1] || '';

      finalResults.push({
        ...row,
        term,
        ca_score: parseFloat(row.ca_score),
        exam_score: parseFloat(row.exam_score),
        total_score: parseFloat(row.total_score),
        position: matched ? matched.position : 'N/A'
      });
    }

    res.status(200).json(finalResults);
  } catch (error) {
    console.error('[Scores] Get teacher results error:', error.message);
    res.status(500).json({ error: 'Server error during teacher results lookup.' });
  }
};

