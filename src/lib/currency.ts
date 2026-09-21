/**
 * Currency registry.
 *
 * Money is stored as an integer number of *minor units*, and the number of
 * minor units per major unit is not always 100: JPY has none, KWD has 1000.
 * Assuming 2 everywhere silently multiplies a Japanese quote by 100, so every
 * parse and every render goes through `minorUnitDigits`.
 */
export interface CurrencyInfo {
  code: string;
  name: string;
  /** Decimal places in the major unit: 0 for JPY, 2 for USD, 3 for KWD. */
  digits: 0 | 2 | 3;
}

const LIST: CurrencyInfo[] = [
  { code: "AED", name: "UAE Dirham", digits: 2 },
  { code: "AUD", name: "Australian Dollar", digits: 2 },
  { code: "BHD", name: "Bahraini Dinar", digits: 3 },
  { code: "BRL", name: "Brazilian Real", digits: 2 },
  { code: "CAD", name: "Canadian Dollar", digits: 2 },
  { code: "CHF", name: "Swiss Franc", digits: 2 },
  { code: "CLP", name: "Chilean Peso", digits: 0 },
  { code: "CNY", name: "Chinese Yuan", digits: 2 },
  { code: "CZK", name: "Czech Koruna", digits: 2 },
  { code: "DKK", name: "Danish Krone", digits: 2 },
  { code: "EGP", name: "Egyptian Pound", digits: 2 },
  { code: "EUR", name: "Euro", digits: 2 },
  { code: "GBP", name: "Pound Sterling", digits: 2 },
  { code: "HKD", name: "Hong Kong Dollar", digits: 2 },
  { code: "HUF", name: "Hungarian Forint", digits: 2 },
  { code: "IDR", name: "Indonesian Rupiah", digits: 2 },
  { code: "ILS", name: "Israeli New Shekel", digits: 2 },
  { code: "INR", name: "Indian Rupee", digits: 2 },
  { code: "ISK", name: "Icelandic Krona", digits: 0 },
  { code: "JOD", name: "Jordanian Dinar", digits: 3 },
  { code: "JPY", name: "Japanese Yen", digits: 0 },
  { code: "KES", name: "Kenyan Shilling", digits: 2 },
  { code: "KRW", name: "South Korean Won", digits: 0 },
  { code: "KWD", name: "Kuwaiti Dinar", digits: 3 },
  { code: "MXN", name: "Mexican Peso", digits: 2 },
  { code: "MYR", name: "Malaysian Ringgit", digits: 2 },
  { code: "NGN", name: "Nigerian Naira", digits: 2 },
  { code: "NOK", name: "Norwegian Krone", digits: 2 },
  { code: "NZD", name: "New Zealand Dollar", digits: 2 },
  { code: "OMR", name: "Omani Rial", digits: 3 },
  { code: "PHP", name: "Philippine Peso", digits: 2 },
  { code: "PKR", name: "Pakistani Rupee", digits: 2 },
  { code: "PLN", name: "Polish Zloty", digits: 2 },
  { code: "QAR", name: "Qatari Riyal", digits: 2 },
  { code: "RON", name: "Romanian Leu", digits: 2 },
  { code: "SAR", name: "Saudi Riyal", digits: 2 },
  { code: "SEK", name: "Swedish Krona", digits: 2 },
  { code: "SGD", name: "Singapore Dollar", digits: 2 },
  { code: "THB", name: "Thai Baht", digits: 2 },
  { code: "TND", name: "Tunisian Dinar", digits: 3 },
  { code: "TRY", name: "Turkish Lira", digits: 2 },
  { code: "TWD", name: "New Taiwan Dollar", digits: 2 },
  { code: "USD", name: "US Dollar", digits: 2 },
  { code: "VND", name: "Vietnamese Dong", digits: 0 },
  { code: "ZAR", name: "South African Rand", digits: 2 },
];

const BY_CODE = new Map(LIST.map((c) => [c.code, c]));

export const CURRENCIES: readonly CurrencyInfo[] = LIST;

export function isKnownCurrency(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

export function currencyInfo(code: string): CurrencyInfo {
  return (
    BY_CODE.get(code.toUpperCase()) ?? {
      code: code.toUpperCase(),
      name: code.toUpperCase(),
      // An unlisted but well-formed code is allowed through at 2 digits, which
      // is correct for the large majority of ISO 4217.
      digits: 2,
    }
  );
}

export function minorUnitDigits(code: string): number {
  return currencyInfo(code).digits;
}

export function minorUnitFactor(code: string): number {
  return 10 ** minorUnitDigits(code);
}
