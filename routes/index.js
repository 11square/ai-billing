const express = require('express');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'billing-api',
    timestamp: new Date().toISOString()
  });
});

router.use('/auth', require('./auth'));
router.use('/grocery', require('./grocery'));
router.use('/fertilizer', require('./fertilizer'));
router.use('/customers', require('./customers'));
router.use('/invoices', require('./invoices'));
router.use('/reports', require('./reports'));
router.use('/purchases', require('./purchases'));
router.use('/vendors', require('./vendors'));
router.use('/staff', require('./staff'));
router.use('/attendance', require('./attendance'));

module.exports = router;
