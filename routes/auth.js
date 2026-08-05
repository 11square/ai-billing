const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET);
};

// Public account creation is intentionally disabled.
router.post('/register', (req, res) => {
  res.status(403).json({
    message: 'Self-registration is disabled. Contact an administrator.'
  });
});

// @route   POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ where: { email } });

    if (user && (await user.matchPassword(password))) {
      res.json({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        activeShop: user.activeShop,
        token: generateToken(user.id)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/auth/shop
router.put('/shop', auth, async (req, res) => {
  try {
    const { shop } = req.body;
    await User.update(
      { activeShop: shop },
      { where: { id: req.user.id } }
    );
    res.json({ message: 'Shop switched successfully', activeShop: shop });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
