interface Item {
  key: string;
  quantity: number;
  enteredShipTo?: string;
  shipTo: string;
  enteredPart?: string;
  part?: string;
  quotedCost?: number;
  enteredCost?: number;
}

export function buildLines(items: Item[]) {
  return items.map((item) => ({
    quantity: item.quantity,
    shipTo: item.enteredShipTo || item.shipTo,
    part: item?.enteredPart || item?.part || null,
    cost: Number(item?.quotedCost ?? item?.enteredCost) || null,
    lineIndex: items.findIndex((other) => other.key === item.key) + 1,
  }));
}
