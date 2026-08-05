const express = require('express');
const { Op } = require('sequelize');
const { Customer, FarmerDetails } = require('../models/Customer');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Find an existing customer by mobile number or create one for a credit sale.
router.post('/resolve', auth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    let phone = String(req.body.phone || '').replace(/\D/g, '');
    if (phone.length === 12 && phone.startsWith('91')) phone = phone.slice(2);

    if (!name) {
      return res.status(400).json({ message: 'Customer name is required for credit sales' });
    }
    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit mobile number' });
    }

    const candidates = await Customer.findAll({
      where: { phone: { [Op.like]: `%${phone.slice(-4)}%` } }
    });
    let customer = candidates.find(candidate => {
      let existingPhone = String(candidate.phone || '').replace(/\D/g, '');
      if (existingPhone.length === 12 && existingPhone.startsWith('91')) existingPhone = existingPhone.slice(2);
      return existingPhone === phone;
    });
    if (customer) {
      if (customer.name !== name) await customer.update({ name });
      return res.json(customer);
    }

    customer = await Customer.create({ name, phone });
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/customers
router.get('/', auth, async (req, res) => {
  try {
    const { search, hasFarmerDetails } = req.query;

    let where = {};

    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { phone: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
        { aadhar: { [Op.like]: `%${search}%` } }
      ];
    }

    const customers = await Customer.findAll({
      where,
      include: [{ model: FarmerDetails, as: 'farmerDetails' }],
      order: [['name', 'ASC']]
    });

    let result = customers;
    if (hasFarmerDetails === 'true') {
      result = customers.filter(c => c.farmerDetails !== null);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/customers/:id
router.get('/:id', auth, async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id, {
      include: [{ model: FarmerDetails, as: 'farmerDetails' }]
    });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/customers
router.post('/', auth, async (req, res) => {
  try {
    const { farmerDetails, ...customerData } = req.body;

    const customer = await Customer.create(customerData);

    if (farmerDetails) {
      await FarmerDetails.create({
        ...farmerDetails,
        customerId: customer.id
      });
    }

    const result = await Customer.findByPk(customer.id, {
      include: [{ model: FarmerDetails, as: 'farmerDetails' }]
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   PUT /api/customers/:id
router.put('/:id', auth, async (req, res) => {
  try {
    const { farmerDetails, ...customerData } = req.body;

    const customer = await Customer.findByPk(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    await customer.update(customerData);

    if (farmerDetails) {
      const existingFarmer = await FarmerDetails.findOne({
        where: { customerId: customer.id }
      });

      if (existingFarmer) {
        await existingFarmer.update(farmerDetails);
      } else {
        await FarmerDetails.create({
          ...farmerDetails,
          customerId: customer.id
        });
      }
    }

    const result = await Customer.findByPk(customer.id, {
      include: [{ model: FarmerDetails, as: 'farmerDetails' }]
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   DELETE /api/customers/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    await customer.destroy();
    res.json({ message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
