const { RawMaterial, RawMaterialMovement } = require('../models/RawMaterial');

const roundQty = value => Math.round(Number(value) * 1000) / 1000;
const roundMoney = value => Math.round(Number(value) * 10000) / 10000;

const convertQuantity = (quantity, fromUnit, toUnit) => {
  const value = Number(quantity);
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid raw-material quantity');
  if (fromUnit === toUnit) return roundQty(value);
  const conversions = {
    'kg:g': 1000,
    'g:kg': 0.001,
    'L:ml': 1000,
    'ml:L': 0.001
  };
  const factor = conversions[`${fromUnit}:${toUnit}`];
  if (!factor) throw new Error(`Cannot convert ${fromUnit} to ${toUnit}`);
  return roundQty(value * factor);
};

const consumeRecipe = async ({ product, quantity, shopType, userId, transaction }) => {
  const recipe = Array.isArray(product.boq) ? product.boq : [];
  if (!recipe.length) throw new Error(`Add a raw-material recipe to ${product.name} before producing stock`);

  const requirements = [];
  for (const line of recipe) {
    const rawMaterialId = Number(line.rawMaterialId);
    if (!rawMaterialId) throw new Error(`Link recipe ingredient "${line.ingredient || 'Unknown'}" to Raw Materials`);
    const material = await RawMaterial.findOne({
      where: { id: rawMaterialId, shopType, isActive: true },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!material) throw new Error(`Raw material not found for ${line.ingredient || 'recipe item'}`);
    const required = convertQuantity(Number(line.qty) * Number(quantity), line.unit, material.unit);
    if (Number(material.stock) + 0.0001 < required) {
      throw new Error(`${material.name} is short by ${roundQty(required - Number(material.stock))} ${material.unit}`);
    }
    requirements.push({ material, required, lineCost: convertQuantity(Number(line.qty), line.unit, material.unit) * Number(material.costPerUnit) });
  }

  let unitProductionCost = 0;
  for (const requirement of requirements) {
    const newStock = roundQty(Number(requirement.material.stock) - requirement.required);
    await requirement.material.update({ stock: newStock }, { transaction });
    await RawMaterialMovement.create({
      rawMaterialId: requirement.material.id,
      movementType: 'production_use',
      direction: 'out',
      quantity: requirement.required,
      balanceAfter: newStock,
      unitCost: requirement.material.costPerUnit,
      referenceType: 'product',
      referenceId: product.id,
      notes: `Produced ${quantity} x ${product.name}`,
      shopType,
      createdBy: userId
    }, { transaction });
    unitProductionCost += requirement.lineCost;
  }

  return { consumed: requirements.length, unitProductionCost: roundMoney(unitProductionCost) };
};

module.exports = { convertQuantity, consumeRecipe, roundQty, roundMoney };
