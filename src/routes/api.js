const express = require('express');
const router = express.Router();

// Controllers
const authController = require('../controllers/authController');
const userController = require('../controllers/userController');
const academicController = require('../controllers/academicController');
const scoreController = require('../controllers/scoreController');

// Middleware
const authMiddleware = require('../middleware/authMiddleware');
const roleGuard = require('../middleware/roleGuard');

// --- Authentication Routes ---
router.post('/auth/login', authController.login);
router.get('/auth/profile', authMiddleware, authController.getProfile);

// --- Admin-only User Management Routes ---
router.post('/users', authMiddleware, roleGuard('Admin'), userController.createUser);
router.get('/users', authMiddleware, roleGuard('Admin'), userController.getUsers);
router.put('/users/:id', authMiddleware, userController.updateUser);
router.delete('/users/:id', authMiddleware, roleGuard('Admin'), userController.deleteUser);

// --- Academic Setup Routes (Old and compatibility mappings) ---
router.post('/academic/subjects', authMiddleware, roleGuard('Admin'), academicController.createSubject);
router.get('/academic/subjects', authMiddleware, roleGuard('Admin', 'Teacher'), academicController.getSubjects);
router.delete('/academic/subjects/:id', authMiddleware, roleGuard('Admin'), academicController.deleteSubject);

router.get('/academic/classes', authMiddleware, roleGuard('Admin', 'Teacher'), academicController.getClasses);
router.post('/academic/classes', authMiddleware, roleGuard('Admin'), academicController.createClass);
router.delete('/academic/classes/:id', authMiddleware, roleGuard('Admin'), academicController.deleteClass);
router.post('/academic/seed-defaults', authMiddleware, roleGuard('Admin'), academicController.seedDefaults);

router.post('/academic/assignments', authMiddleware, roleGuard('Admin'), academicController.createAssignment);
router.get('/academic/assignments', authMiddleware, roleGuard('Admin'), academicController.getAssignments);
router.delete('/academic/assignments/:id', authMiddleware, roleGuard('Admin'), academicController.deleteAssignment);

// --- Custom Student / Teacher / Parent / Subject List Routes for Frontend ---
router.get('/students', authMiddleware, userController.getStudentsList);
router.post('/students/:id/promote', authMiddleware, roleGuard('Admin'), userController.promoteStudent);
router.get('/teachers', authMiddleware, userController.getTeachersList);
router.get('/parents', authMiddleware, userController.getParentsList);
router.get('/subjects', authMiddleware, academicController.getSubjects);
router.post('/subjects', authMiddleware, roleGuard('Admin'), academicController.createSubject);

// --- Teacher Dashboard Routes ---
router.get('/teacher/stats', authMiddleware, roleGuard('Teacher'), scoreController.getTeacherStats);
router.get('/teacher/classes', authMiddleware, roleGuard('Teacher'), scoreController.getTeacherClasses);
router.get('/teacher/students/:className', authMiddleware, roleGuard('Teacher'), scoreController.getStudentsByClass);
router.get('/teacher/results', authMiddleware, roleGuard('Teacher'), scoreController.getTeacherResults);
router.post('/scores', authMiddleware, roleGuard('Teacher'), scoreController.submitScores);

// --- Results Bulk Submission ---
router.post('/results/bulk', authMiddleware, roleGuard('Teacher'), scoreController.submitScoresBulk);

// --- Results & Reports Routes ---
router.get('/results/pending', authMiddleware, roleGuard('Admin'), scoreController.getPendingResults);
router.post('/results/approve', authMiddleware, roleGuard('Admin'), scoreController.approveResults);
router.post('/results/allow-reupload', authMiddleware, roleGuard('Admin'), scoreController.allowReupload);
router.get('/results/my', authMiddleware, roleGuard('Student'), scoreController.getMyResults);
router.get('/results/child', authMiddleware, roleGuard('Parent'), scoreController.getChildResults);
router.get('/results/:studentId', authMiddleware, scoreController.getStudentResults);
router.get('/results', authMiddleware, scoreController.getAllResults);
router.get('/reports/stats', authMiddleware, roleGuard('Admin'), scoreController.getDashboardStats);

module.exports = router;
