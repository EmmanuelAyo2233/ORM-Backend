module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Authenticated user profile not found.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Forbidden. You do not have permissions to access this resources.',
        required_roles: allowedRoles,
        your_role: req.user.role 
      });
    }

    next();
  };
};
