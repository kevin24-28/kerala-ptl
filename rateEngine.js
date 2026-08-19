const ROUTE_CONFIG = {
  "KOCHI-KOZHIKODE": { baseRatePerKg: 5.50, minCharge: 350 },
  "KOCHI-TRIVANDRUM": { baseRatePerKg: 5.00, minCharge: 350 },
  "KOCHI-THRISSUR": { baseRatePerKg: 4.00, minCharge: 250 },
  "THRISSUR-KOZHIKODE": { baseRatePerKg: 4.50, minCharge: 300 },
  "KOZHIKODE-KOCHI": { baseRatePerKg: 5.00, minCharge: 350 },
  "TRIVANDRUM-KOCHI": { baseRatePerKg: 5.00, minCharge: 350 }
};

const DOCKET_FEE = 120.00;
const FSC_PERCENTAGE = 0.10;
const GST_PERCENTAGE = 0.05;

function calculateFreightBreakdown(origin, destination, deadWeightKg, cftVolume = 0) {
  const routeKey = `${origin.toUpperCase()}-${destination.toUpperCase()}`;
  const route = ROUTE_CONFIG[routeKey] || { baseRatePerKg: 6.00, minCharge: 400 };

  const volumetricWeightKg = Number(cftVolume || 0) * 6;
  const chargeableWeight = Math.max(Number(deadWeightKg), volumetricWeightKg);

  let baseFreight = chargeableWeight * route.baseRatePerKg;
  if (baseFreight < route.minCharge) {
    baseFreight = route.minCharge;
  }

  const fuelSurcharge = baseFreight * FSC_PERCENTAGE;
  const subTotal = baseFreight + DOCKET_FEE + fuelSurcharge;
  const gstAmount = subTotal * GST_PERCENTAGE;
  const grandTotal = Math.round(subTotal + gstAmount);

  return {
    chargeableWeight,
    baseFreight: Math.round(baseFreight),
    docketFee: DOCKET_FEE,
    fuelSurcharge: Math.round(fuelSurcharge),
    gstAmount: Math.round(gstAmount),
    totalPayable: grandTotal
  };
}

module.exports = { calculateFreightBreakdown };
