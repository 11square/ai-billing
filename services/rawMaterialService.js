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

const recipeQuantity = (product, soldQuantity) => product.saleMode === 'measured'
  ? Number(soldQuantity) / 1000
  : Number(soldQuantity);

const recipeRequirements = async ({ product, quantity, shopType, transaction }) => {
  const recipe = Array.isArray(product.boq) ? product.boq : [];
  if (!recipe.length) throw new Error(`Add a raw-material recipe to ${product.name} before billing it`);

  const totals = new Map();
  for (const line of recipe) {
    const rawMaterialId = Number(line.rawMaterialId);
    if (!rawMaterialId) throw new Error(`Link recipe ingredient "${line.ingredient || 'Unknown'}" to an Inventory item`);
    const lineQuantity = Number(line.qty) * Number(quantity);
    if (!Number.isFinite(lineQuantity) || lineQuantity <= 0) throw new Error(`Enter a valid recipe quantity for ${line.ingredient || 'raw material'}`);
    const current = totals.get(rawMaterialId) || { rawMaterialId, lines: [] };
    current.lines.push({ ...line, lineQuantity });
    totals.set(rawMaterialId, current);
  }

  const requirements = [];
  for (const entry of totals.values()) {
    const material = await RawMaterial.findOne({
      where: { id: entry.rawMaterialId, shopType, isActive: true },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!material) throw new Error(`Inventory item not found for ${entry.lines[0].ingredient || 'recipe item'}`);
    const required = roundQty(entry.lines.reduce((sum, line) => sum + convertQuantity(line.lineQuantity, line.unit, material.unit), 0));
    const unitRequired = roundQty(entry.lines.reduce((sum, line) => sum + convertQuantity(Number(line.qty), line.unit, material.unit), 0));
    requirements.push({ material, required, lineCost: unitRequired * Number(material.costPerUnit) });
  }

  return requirements;
};

const consumeRecipe = async ({ product, quantity, shopType, userId, transaction, referenceType = 'product', referenceId = product.id, notes }) => {
  const requirements = await recipeRequirements({ product, quantity, shopType, transaction });

  for (const requirement of requirements) {
    if (Number(requirement.material.stock) + 0.0001 < requirement.required) {
      throw new Error(`${requirement.material.name} is short by ${roundQty(requirement.required - Number(requirement.material.stock))} ${requirement.material.unit}`);
    }
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
      referenceType,
      referenceId,
      notes: notes || `Used for ${quantity} x ${product.name}`,
      shopType,
      createdBy: userId
    }, { transaction });
    unitProductionCost += requirement.lineCost;
  }

  return { consumed: requirements.length, unitProductionCost: roundMoney(unitProductionCost) };
};

const restoreRecipe = async ({ product, quantity, shopType, userId, transaction, referenceType, referenceId, notes, capToRecorded = false }) => {
  const requirements = await recipeRequirements({ product, quantity, shopType, transaction });
  let recordedByMaterial = null;
  if (capToRecorded) {
    recordedByMaterial = new Map();
    const movements = await RawMaterialMovement.findAll({ where: { referenceType, referenceId, shopType }, transaction, lock: transaction.LOCK.UPDATE });
    movements.forEach(movement => {
      const signed = movement.direction === 'out' ? Number(movement.quantity) : -Number(movement.quantity);
      recordedByMaterial.set(movement.rawMaterialId, roundQty((recordedByMaterial.get(movement.rawMaterialId) || 0) + signed));
    });
  }
  let restored = 0;
  for (const requirement of requirements) {
    const quantityToRestore = capToRecorded
      ? Math.max(0, Math.min(requirement.required, recordedByMaterial.get(requirement.material.id) || 0))
      : requirement.required;
    if (quantityToRestore <= 0) continue;
    const newStock = roundQty(Number(requirement.material.stock) + quantityToRestore);
    await requirement.material.update({ stock: newStock }, { transaction });
    await RawMaterialMovement.create({
      rawMaterialId: requirement.material.id,
      movementType: 'adjustment_in',
      direction: 'in',
      quantity: quantityToRestore,
      balanceAfter: newStock,
      unitCost: requirement.material.costPerUnit,
      referenceType,
      referenceId,
      notes: notes || `Restored from ${product.name}`,
      shopType,
      createdBy: userId
    }, { transaction });
    restored += 1;
  }
  return { restored };
};

const reverseRecordedConsumption = async ({ referenceType, referenceIds, shopType, userId, transaction, reversalType, reversalId, notes }) => {
  const ids = [...new Set((Array.isArray(referenceIds) ? referenceIds : [referenceIds]).map(Number).filter(Boolean))];
  if (!ids.length) return { restored: 0 };
  const movements = await RawMaterialMovement.findAll({
    where: { referenceType, referenceId: ids, shopType },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  const netByMaterial = new Map();
  movements.forEach(movement => {
    const signed = movement.direction === 'out' ? Number(movement.quantity) : -Number(movement.quantity);
    netByMaterial.set(movement.rawMaterialId, roundQty((netByMaterial.get(movement.rawMaterialId) || 0) + signed));
  });

  let restored = 0;
  for (const [rawMaterialId, quantity] of netByMaterial.entries()) {
    if (quantity <= 0) continue;
    const material = await RawMaterial.findOne({ where: { id: rawMaterialId, shopType }, transaction, lock: transaction.LOCK.UPDATE });
    if (!material) continue;
    const newStock = roundQty(Number(material.stock) + quantity);
    await material.update({ stock: newStock }, { transaction });
    await RawMaterialMovement.create({
      rawMaterialId,
      movementType: 'adjustment_in',
      direction: 'in',
      quantity,
      balanceAfter: newStock,
      unitCost: material.costPerUnit,
      referenceType: reversalType,
      referenceId: reversalId,
      notes,
      shopType,
      createdBy: userId
    }, { transaction });
    restored += 1;
  }
  return { restored };
};

module.exports = { convertQuantity, consumeRecipe, restoreRecipe, reverseRecordedConsumption, recipeQuantity, roundQty, roundMoney };
