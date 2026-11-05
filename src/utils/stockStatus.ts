interface InstrumentStatusInput {
  exchange: string;
  name: string;
  ext?: {
    total_shares?: number;
    float_shares?: number;
  };
}

function isNonPositive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value <= 0;
}

export function isDelistedInstrument(item: InstrumentStatusInput): boolean {
  if (item.name.replace(/\s+/g, '').includes('退市')) return true;
  if (item.exchange === 'HK') return false;
  return isNonPositive(item.ext?.total_shares) || isNonPositive(item.ext?.float_shares);
}
