// Widget-validatie-ENGINE (gedeeld, browser-veilig, geen node-imports). De fabriek
// emit per provider een dun generated-bestand dat deze engine aanroept met de
// declaratieve regels (portals/<p>/widget/validation.json) + domein + messages.
// Semantiek is 1-op-1 geport uit v1's generated validators (B_getRates_0 +
// D_submitShipmentbase_0) en wordt bewaakt door de oracle-fixtures
// (fixtures/widget-validators-oracle.json, zie verify-widget-validators).

export interface ValidationResult {
  valid: boolean;
  message?: string;
  path?: string;
  reason?: "required" | "invalid_format" | "out_of_range" | "max_length" | "unknown_value";
}
type Reason = NonNullable<ValidationResult["reason"]>;

export interface Range2 { 0: number; 1: number }
export interface WidgetValidationRules {
  addressFieldMax: number;
  nameTotalMax: number;
  postalMaxNoFormat: number;
  regionRequiredCountries: string[];
  packageLimits: Record<string, { length: number[]; width: number[]; height: number[]; weight: number[]; aggregateDims?: { length: number[]; width: number[]; height: number[] } }>;
  productLine: { hsPattern: string; descriptionMax: number; weight: number[]; value: number[] };
  shipmentOptions: { descriptionMax: number };
}

export interface WidgetValidationConfig {
  rules: WidgetValidationRules;
  domain: { countries: string[]; postalCodes: Record<string, string>; [k: string]: unknown };
  messages: Record<string, unknown>; // { NL: {...}, EN: {...}, ... }
}

// ---- i18n (als v1's translations/i18n.ts: {var}-interpolatie, default NL) --------
function getPath(obj: any, path: string): any {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

// ---- postcode-DSL (verbatim uit v1) ----------------------------------------------
const RX_META = /[.*+?^${}()|[\]\\]/g;
const escapeRx = (s: string) => s.replace(RX_META, "\\$&");
const isWhitespace = (ch: string) => /\s/.test(ch);

function expandCountryPrefix(pattern: string, country: string): string {
  if (!country) return pattern;
  const cc = country.toUpperCase();
  return pattern.replace(/C{2,}/g, (m) => cc.slice(0, m.length));
}

export function patternToRegex(pattern: string, country?: string): RegExp[] {
  if (!pattern || pattern === "geen") return [/^.*$/];
  const alts = pattern.split(/\s*,\s*/).filter(Boolean);
  const regs: RegExp[] = [];
  for (let alt of alts) {
    alt = expandCountryPrefix(alt.trim(), country ?? "");
    const parts: string[] = [];
    for (let i = 0; i < alt.length; i++) {
      const ch = alt[i];
      if (ch === "[") {
        const end = alt.indexOf("]", i);
        if (end === -1) throw new Error("Unclosed [ in pattern");
        const group = alt.slice(i + 1, end);
        if (group === "A/N") parts.push("[A-Z0-9]");
        else {
          let g = "";
          for (const c of group) {
            if (c === "A") g += "[A-Z]";
            else if (c === "a") g += "[a-z]";
            else if (c === "N") g += "\\d";
            else if (c === " ") g += " ";
            else if (c === "-") g += "-";
            else g += escapeRx(c);
          }
          parts.push(g);
        }
        i = end;
        continue;
      }
      if (ch === "?") {
        if (parts.length === 0) throw new Error("Dangling ? in pattern");
        parts[parts.length - 1] = `(?:${parts[parts.length - 1]})?`;
        continue;
      }
      if (ch === "A") parts.push("[A-Z]");
      else if (ch === "a") parts.push("[a-z]");
      else if (ch === "N") parts.push("\\d");
      else if (ch === " ") parts.push(" ");
      else if (ch === "-") parts.push("-");
      else if (isWhitespace(ch)) parts.push(" ");
      else parts.push(escapeRx(ch));
    }
    regs.push(new RegExp("^" + parts.join("") + "$", "i"));
  }
  return regs;
}

export function generatePostalCodeExample(pattern: string, country?: string): string {
  if (!pattern || pattern === "geen") return "";
  const alts = pattern.split(",").map((s) => expandCountryPrefix(s.trim(), country ?? ""));
  const p = alts.sort((a, b) => a.length - b.length)[0];
  const digitSeq = "1234567890";
  const upperSeq = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowerSeq = "abcdefghijklmnopqrstuvwxyz";
  let numIndex = 0, upperIndex = 0, lowerIndex = 0;
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "[") {
      const end = p.indexOf("]", i);
      const group = p.slice(i + 1, end);
      if (group === "A/N") out += upperSeq[upperIndex++ % upperSeq.length];
      else {
        const pick = (sym: string) =>
          sym === "A" ? upperSeq[upperIndex++ % upperSeq.length]
          : sym === "a" ? lowerSeq[lowerIndex++ % lowerSeq.length]
          : sym === "N" ? digitSeq[numIndex++ % digitSeq.length]
          : sym === " " ? " " : sym === "-" ? "-" : sym;
        out += pick(group[0] ?? "");
      }
      i = end;
      continue;
    }
    if (c === "?") continue;
    if (c === "A") out += upperSeq[upperIndex++ % upperSeq.length];
    else if (c === "a") out += lowerSeq[lowerIndex++ % lowerSeq.length];
    else if (c === "N") out += digitSeq[numIndex++ % digitSeq.length];
    else if (c === " ") out += " ";
    else if (isWhitespace(c)) out += " ";
    else out += c;
  }
  return out;
}

function inRange(val: number | null | undefined, min: number, max: number): boolean {
  return typeof val === "number" && val >= min && val <= max;
}

// ---- opbouw ----------------------------------------------------------------------
export interface FieldValidator {
  dependsOn: (template: any) => any;
  validate: (deps: any) => ValidationResult | Promise<ValidationResult>;
}

export function buildWidgetValidators(config: WidgetValidationConfig) {
  const { rules, domain, messages } = config;

  let currentLang = "NL";
  function setLanguage(lang: string) {
    if ((messages as any)[lang]) currentLang = lang;
  }
  function t(key: string, params?: Record<string, any>): string {
    const template = getPath((messages as any)[currentLang], key);
    if (typeof template !== "string") return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  }
  const tB = (key: string, vars?: Record<string, any>) => t(`B_getRates_0.validation.${key}`, vars);
  const tD = (key: string, vars?: Record<string, any>) => t(`D_submitShipmentbase.validation.${key}`, vars);

  const ok = (): ValidationResult => ({ valid: true });
  const fail = (path: string, reason: Reason, message?: string): ValidationResult => ({ valid: false, message, path, reason });
  const firstInvalid = (results: ValidationResult[]): ValidationResult => results.find((r) => !r.valid) ?? ok();

  const MAX = rules.addressFieldMax;
  const NAME_TOTAL_MAX = rules.nameTotalMax;

  // ---------- B_getRates-suite (adres + pakketten; v1-functienamen) ----------------
  function validateShipperAddressCountry(country: string): ValidationResult {
    if (!country) return fail("shipper.country", "required", tB("shipper.countryRequired"));
    if (!domain.countries.includes(country)) return fail("shipper.country", "unknown_value", tB("shipper.unknownCountry", { value: country }));
    return ok();
  }
  function validateRecipientAddressCountry(country: string): ValidationResult {
    if (!country) return fail("recipient.country", "required", tB("recipient.countryRequired"));
    if (!domain.countries.includes(country)) return fail("recipient.country", "unknown_value", tB("recipient.unknownCountry", { value: country }));
    return ok();
  }

  function postalValidator(side: "shipper" | "recipient") {
    return (postalCode: string, country: string): ValidationResult => {
      const path = `${side}.postalCode`;
      if (!country) {
        if (!postalCode) return fail(path, "required", tB("shipper.postalcodeRequired"));
        return ok();
      }
      const pattern = domain.postalCodes[country];
      if (!pattern) return ok();
      if (pattern === "geen") {
        if ((postalCode || "").length > rules.postalMaxNoFormat) return fail(path, "max_length", tB("shipper.postalcodeMax8"));
        return ok();
      }
      if (!postalCode) {
        return fail(path, "required", tB("shipper.postalcodeFormatExample", { example: generatePostalCodeExample(pattern, country) }));
      }
      const trimmed = postalCode.trim().replace(/\s+/g, " ");
      const regexes = patternToRegex(pattern, country);
      if (!regexes.some((rx) => rx.test(trimmed))) {
        return fail(path, "invalid_format", tB("shipper.postalcodeFormatExample", { example: generatePostalCodeExample(pattern, country) }));
      }
      return ok();
    };
  }
  const validateShipperAddressPostalCode = postalValidator("shipper");
  const validateRecipientAddressPostalCode = postalValidator("recipient");

  function validateShipperAddressStreet0_(street0: any): ValidationResult {
    if (!street0) return fail("shipper.street", "required", tB("shipper.streetRequired"));
    if (street0.length > MAX) return fail("shipper.street", "max_length", tB("shipper.streetMaxLength"));
    return ok();
  }
  function validateShipperAddressStreet1_(street1: any): ValidationResult {
    if (street1?.length > MAX) return fail("shipperAddress.houseNumber", "max_length", tB("shipper.streetAdditionTooLong"));
    return ok();
  }
  function validateShipperAddressCity(city: string): ValidationResult {
    if (!city) return fail("shipper.city", "required", tB("shipper.cityRequired"));
    if (city.length > MAX) return fail("shipper.city", "max_length", tB("shipper.cityMaxLength"));
    return ok();
  }
  function validateRecipientAddressStreet0_(street0: any): ValidationResult {
    if (!street0) return fail("recipient.street", "required", tB("recipient.streetRequired"));
    if (street0.length > MAX) return fail("recipient.street", "max_length", tB("recipient.streetMaxLength"));
    return ok();
  }
  function validateRecipientAddressStreet1_(street1: any): ValidationResult {
    if (street1?.length > MAX) return fail("recipient.houseNumber", "max_length", tB("recipient.streetAdditionTooLong"));
    return ok();
  }
  function validateRecipientAddressCity(city: string): ValidationResult {
    if (!city) return fail("recipient.city", "required", tB("recipient.cityRequired"));
    if (city.length > MAX) return fail("recipient.city", "max_length", tB("recipient.cityMaxLength"));
    return ok();
  }

  function validateRecipientAddressRegion(region: string, recipientAddress: any): ValidationResult {
    const country = (recipientAddress?.country || "").toUpperCase();
    if (rules.regionRequiredCountries.includes(country)) {
      if (!region || !String(region).trim()) return fail("recipient.region", "required", tB("recipient.regionRequired"));
    }
    return ok();
  }

  function validateShipperAddressPhoneNumber(phoneNumber: string | undefined): ValidationResult {
    if (!phoneNumber || !String(phoneNumber).trim()) return fail("shipper.phoneNumber", "required", tB("shipper.phoneNumberRequired"));
    return ok();
  }
  function validateRecipientAddressPhoneNumber(phoneNumber: string | undefined): ValidationResult {
    if (!phoneNumber || !String(phoneNumber).trim()) return fail("recipient.phoneNumber", "required", tB("recipient.phoneNumberRequired"));
    return ok();
  }

  function validateRecipientFirstName(firstName: string, recipientAddress: any): ValidationResult {
    const first = (firstName ?? "").trim();
    const last = (recipientAddress?.lastName ?? "").trim();
    if (!first) return fail("recipient.firstName", "required", tB("recipient.firstNameRequired"));
    if (first.length + last.length + 1 > NAME_TOTAL_MAX) {
      return fail("recipient.firstName", "max_length", tB("recipient.nameMaxLength", { max: NAME_TOTAL_MAX }));
    }
    return ok();
  }
  function validateRecipientLastName(lastName: string, recipientAddress: any): ValidationResult {
    const last = (lastName ?? "").trim();
    const first = (recipientAddress?.firstName ?? "").trim();
    if (!last) return fail("recipient.lastName", "required", tB("recipient.lastNameRequired"));
    if (first.length + last.length + 1 > NAME_TOTAL_MAX) {
      return fail("recipient.lastName", "max_length", tB("recipient.nameMaxLength", { max: NAME_TOTAL_MAX }));
    }
    return ok();
  }

  function validateShipperAddress(shipperAddress: any): ValidationResult {
    const address = shipperAddress ?? {};
    return firstInvalid([
      validateShipperAddressCountry(address.country),
      validateShipperAddressStreet0_(address.street?.[0]),
      validateShipperAddressStreet1_(address.street?.[1]),
      validateShipperAddressCity(address.city),
      validateShipperAddressPostalCode(address.postalCode, address.country),
      validateShipperAddressPhoneNumber(address.phoneNumber),
    ]);
  }
  function validateRecipientAddress(recipientAddress: any): ValidationResult {
    const address = recipientAddress ?? {};
    return firstInvalid([
      validateRecipientFirstName(address.firstName, address),
      validateRecipientLastName(address.lastName, address),
      validateRecipientAddressCountry(address.country),
      validateRecipientAddressRegion(address.region, address),
      validateRecipientAddressStreet0_(address.street?.[0]),
      validateRecipientAddressStreet1_(address.street?.[1]),
      validateRecipientAddressCity(address.city),
      validateRecipientAddressPostalCode(address.postalCode, address.country),
      validateRecipientAddressPhoneNumber(address.phoneNumber),
    ]);
  }

  // ---------- pakketten ------------------------------------------------------------
  function validatePackages(packages: any[]): ValidationResult[] {
    const lim = rules.packageLimits;
    return packages.map((pkg, i) => {
      const base = `packages[${i}]`;
      if (!pkg.type) return fail(`${base}.type`, "required", tB("package.missingType", { i: i + 1 }));
      const { length, width, height, weight } = pkg;
      if (!Object.keys(lim).includes(pkg.type)) return fail(`${base}.type`, "unknown_value", tB("package.unknownType", { type: pkg.type }));
      const isPallet = pkg.type === "pallet";
      const isDoc = pkg.type === "document";
      const isPack = pkg.type === "package";
      const p = lim.pallet, d = lim.document, k = lim.package;
      const dd = d.aggregateDims ?? d;
      if (isPallet && (!inRange(length, p.length[0], p.length[1]) || !inRange(width, p.width[0], p.width[1]) || !inRange(height, p.height[0], p.height[1])))
        return fail(`${base}`, "out_of_range", tB("package.palletDimsExceeded"));
      if (isPallet && !inRange(weight, p.weight[0], p.weight[1])) return fail(`${base}.weight`, "out_of_range", tB("package.palletWeightExceeded"));
      if (isDoc && (!inRange(length, dd.length[0], dd.length[1]) || !inRange(width, dd.width[0], dd.width[1]) || !inRange(height, dd.height[0], dd.height[1])))
        return fail(`${base}`, "out_of_range", tB("package.docDimsExceeded"));
      if (isDoc && !inRange(weight, d.weight[0], d.weight[1])) return fail(`${base}.weight`, "out_of_range", tB("package.docWeightExceeded"));
      if (isPack && (!inRange(length, k.length[0], k.length[1]) || !inRange(width, k.width[0], k.width[1]) || !inRange(height, k.height[0], k.height[1])))
        return fail(`${base}`, "out_of_range", tB("package.pkgDimsExceeded"));
      if (isPack && !inRange(weight, k.weight[0], k.weight[1])) return fail(`${base}.weight`, "out_of_range", tB("package.pkgWeightExceeded"));
      return ok();
    });
  }

  // Per-veld pakketvalidators: v1 gebruikt aparte maxima per type + eigen message-keys.
  function packageFieldValidator(field: "length" | "width" | "height" | "weight") {
    const cap = field.charAt(0).toUpperCase() + field.slice(1);
    return (pkg: any): ValidationResult => {
      const raw = pkg?.[field];
      const v = Number(raw);
      const path = `packages[].${field}`;
      if (raw == null || Number.isNaN(v)) return fail(path, "required", tB(`package.${field}Required`));
      if (v < 1) return fail(path, "out_of_range", tB(`package.${field}Min`));
      const type = pkg?.type;
      const lim = rules.packageLimits[type];
      if (!lim) return fail("packages[].type", "unknown_value", tB("package.unknownType", { type }));
      const max = (lim as any)[field][1];
      if (field === "weight") {
        if (v > max) {
          if (type === "pallet") return fail(path, "out_of_range", tB("package.palletWeightExceeded"));
          return fail(path, "out_of_range", tB("package.weightMax", { type, max }));
        }
        return ok();
      }
      if (v > max) {
        if (type === "pallet") return fail(path, "out_of_range", tB(`package.${field}MaxPallet`));
        return fail(path, "out_of_range", tB(`package.${field}Max`, { max }));
      }
      return ok();
    };
  }
  const validatePackageLength = packageFieldValidator("length");
  const validatePackageWidth = packageFieldValidator("width");
  const validatePackageHeight = packageFieldValidator("height");
  const validatePackageWeight = packageFieldValidator("weight");

  function validateShipmentOptionsTruckShipmentInfo(_t: any): ValidationResult { return ok(); }

  // ---------- D_submitShipmentbase-suite (douane-grid; §4: DE ene product-line-laag)
  const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
  const normalizeCountry = (c?: string | null) => String(c ?? "").trim().toUpperCase();
  function isNonEUExportImport(params: { shipperCountry?: string | null; recipientCountry?: string | null }): boolean {
    const shipper = normalizeCountry(params.shipperCountry);
    const recipient = normalizeCountry(params.recipientCountry);
    if (!shipper || !recipient) return false;
    return !EU.includes(shipper) || !EU.includes(recipient);
  }

  const hsRx = new RegExp(rules.productLine.hsPattern);
  const pl = rules.productLine;

  function validateItemDescription(item: { description?: string }): ValidationResult {
    if (!item.description || item.description === "") return fail("products[].description", "required", tD("item.descriptionRequired"));
    if (item.description.length > pl.descriptionMax) return fail("products[].description", "max_length", tD("item.descriptionTooLong"));
    return ok();
  }
  function validateItemWeight(item: { weight?: string | number }): ValidationResult {
    const num = Number(item.weight);
    if (item.weight == null || Number.isNaN(num)) return fail("products[].weight", "required", tD("item.weightRequired"));
    if (num < pl.weight[0]) return fail("products[].weight", "out_of_range", tD("item.weightMin"));
    if (num > pl.weight[1]) return fail("products[].weight", "out_of_range", tD("item.weightMax"));
    return ok();
  }
  function validateItemValue(item: { value?: string | number }): ValidationResult {
    const num = Number(item.value);
    if (item.value == null || Number.isNaN(num)) return fail("products[].value", "required", tD("item.valueRequired"));
    if (num < pl.value[0]) return fail("products[].value", "out_of_range", tD("item.valueMin"));
    if (num > pl.value[1]) return fail("products[].value", "out_of_range", tD("item.valueMax"));
    return ok();
  }
  function validateOriginCountry(item: { originCountry?: string }): ValidationResult {
    const code = item.originCountry?.trim().toUpperCase();
    if (!code) return fail("products[].originCountry", "required", tD("item.originRequired"));
    if (!/^[A-Z]{2}$/.test(code)) return fail("products[].originCountry", "invalid_format", tD("item.originInvalid"));
    return ok();
  }
  function validateHsCode(item: { hsCode?: string }): ValidationResult {
    if (!item.hsCode || !hsRx.test(item.hsCode.replace(/[.\s]/g, ""))) return fail("products[].hsCode", "invalid_format", tD("item.hsCodeInvalid"));
    return ok();
  }
  function validateProducts(products: any[]): ValidationResult[] {
    return products.map((product, i) => {
      const label = `Product ${i + 1}`;
      const base = `products[${i}]`;
      if (!product.description?.trim()) return fail(`${base}.description`, "required", tD("product.missingDescription", { label }));
      if (!product.hsCode || !hsRx.test(product.hsCode.replace(/[.\s]/g, ""))) return fail(`${base}.hsCode`, "invalid_format", tD("product.invalidHsCode", { label }));
      const quantity = product.packageAssignments?.reduce((total: number, assignment: any) => {
        const perSku = assignment[product.sku];
        return total + (perSku ? (Object.values(perSku) as number[]).reduce((a, b) => a + b, 0) : 0);
      }, 0) ?? 1;
      if (quantity <= 0) return fail(`${base}.quantity`, "out_of_range", tD("product.quantityTooLow", { label }));
      if (!product.originCountry || product.originCountry.length !== 2) return fail(`${base}.originCountry`, "invalid_format", tD("product.missingOrigin", { label }));
      if (product.weight <= 0) return fail(`${base}.weight`, "out_of_range", tD("product.weightTooLow", { label }));
      if (product.value <= 0) return fail(`${base}.value`, "out_of_range", tD("product.valueTooLow", { label }));
      if (!product.currency) return fail(`${base}.currency`, "required", tD("product.missingCurrency", { label }));
      return ok();
    });
  }
  function validateShipmentOptionsDescription(description: string): ValidationResult {
    if (!description || description === "" || description.length < 1) return fail("shippingOptions.description", "required", tD("item.descriptionRequired"));
    if (description.length > rules.shipmentOptions.descriptionMax) return fail("shippingOptions.description", "max_length", tD("item.descriptionTooLong"));
    return ok();
  }
  function validateShipmentOptionsTotalShipmentValue(total: number, shipperAddress: any, recipientAddress: any): ValidationResult {
    if (!isNonEUExportImport({ shipperCountry: shipperAddress?.country, recipientCountry: recipientAddress?.country })) return ok();
    if (total == null || Number(total) <= 0) return fail("shippingOptions.totalValue", "required", tD("item.valueRequired"));
    return ok();
  }
  function validateShipmentOptionsIncotermsGroupD(incoterm: string, shipperAddress: any, recipientAddress: any): ValidationResult {
    if (!isNonEUExportImport({ shipperCountry: shipperAddress?.country, recipientCountry: recipientAddress?.country })) return ok();
    if (incoterm !== "DAP" && incoterm !== "DDP" && incoterm !== "EXW") return fail("shippingOptions.incoterm", "unknown_value", tD("shipmentOptions.incotermsGroupDInvalid"));
    return ok();
  }
  function validateShipmentOptionsShipmentOriginCountry(origin: string, shipperAddress: any, recipientAddress: any): ValidationResult {
    if (!isNonEUExportImport({ shipperCountry: shipperAddress?.country, recipientCountry: recipientAddress?.country })) return ok();
    const code = normalizeCountry(origin);
    if (!code) return fail("shippingOptions.originCountry", "required", tD("item.originRequired"));
    if (!/^[A-Z]{2}$/.test(code)) return fail("shippingOptions.originCountry", "invalid_format", tD("item.originInvalid"));
    return ok();
  }

  // ---------- widget-consumable maps (vorm van v1's getRatesValidate) --------------
  const fieldValidators: Record<string, FieldValidator> = {
    shipperAddress_country: {
      dependsOn: (t) => ({ shipperAddress_country: t.shipperAddress?.country }),
      validate: ({ shipperAddress_country }) => validateShipperAddressCountry(shipperAddress_country),
    },
    shipperAddress: {
      dependsOn: (t) => ({ shipperAddress: t.shipperAddress }),
      validate: ({ shipperAddress }) => validateShipperAddress(shipperAddress),
    },
    recipientAddress: {
      dependsOn: (t) => ({ recipientAddress: t.recipientAddress }),
      validate: ({ recipientAddress }) => validateRecipientAddress(recipientAddress),
    },
    shipperAddress_postalCode: {
      dependsOn: (t) => ({ postalCode: t.shipperAddress?.postalCode, country: t.shipperAddress?.country }),
      validate: ({ postalCode, country }) => validateShipperAddressPostalCode(postalCode, country),
    },
    shipperAddress_street_0_: {
      dependsOn: (t) => ({ street0: t.shipperAddress?.street?.[0] }),
      validate: ({ street0 }) => validateShipperAddressStreet0_(street0),
    },
    shipperAddress_street_1_: {
      dependsOn: (t) => ({ street1: t.shipperAddress?.street?.[1] }),
      validate: ({ street1 }) => validateShipperAddressStreet1_(street1),
    },
    shipperAddress_city: {
      dependsOn: (t) => ({ city: t.shipperAddress?.city }),
      validate: ({ city }) => validateShipperAddressCity(city),
    },
    shipperAddress_phoneNumber: {
      dependsOn: (t) => ({ phone: t.shipperAddress?.phoneNumber }),
      validate: ({ phone }) => validateShipperAddressPhoneNumber(phone),
    },
    recipientAddress_country: {
      dependsOn: (t) => ({ recipientAddress_country: t.recipientAddress?.country }),
      validate: ({ recipientAddress_country }) => validateRecipientAddressCountry(recipientAddress_country),
    },
    recipientAddress_region: {
      dependsOn: (t) => ({ region: t.recipientAddress?.region, recipientAddress: t.recipientAddress }),
      validate: ({ region, recipientAddress }) => validateRecipientAddressRegion(region, recipientAddress),
    },
    recipientAddress_postalCode: {
      dependsOn: (t) => ({ postalCode: t.recipientAddress?.postalCode, country: t.recipientAddress?.country }),
      validate: ({ postalCode, country }) => validateRecipientAddressPostalCode(postalCode, country),
    },
    recipientAddress_street_0_: {
      dependsOn: (t) => ({ street0: t.recipientAddress?.street?.[0] }),
      validate: ({ street0 }) => validateRecipientAddressStreet0_(street0),
    },
    recipientAddress_street_1_: {
      dependsOn: (t) => ({ street1: t.recipientAddress?.street?.[1] }),
      validate: ({ street1 }) => validateRecipientAddressStreet1_(street1),
    },
    recipientAddress_city: {
      dependsOn: (t) => ({ city: t.recipientAddress?.city }),
      validate: ({ city }) => validateRecipientAddressCity(city),
    },
    recipientAddress_firstName: {
      dependsOn: (t) => ({ firstName: t.recipientAddress?.firstName, recipientAddress: t.recipientAddress }),
      validate: ({ firstName, recipientAddress }) => validateRecipientFirstName(firstName, recipientAddress),
    },
    recipientAddress_lastName: {
      dependsOn: (t) => ({ lastName: t.recipientAddress?.lastName, recipientAddress: t.recipientAddress }),
      validate: ({ lastName, recipientAddress }) => validateRecipientLastName(lastName, recipientAddress),
    },
    recipientAddress_phoneNumber: {
      dependsOn: (t) => ({ phone: t.recipientAddress?.phoneNumber }),
      validate: ({ phone }) => validateRecipientAddressPhoneNumber(phone),
    },
    packages: {
      dependsOn: (t) => ({ packages: t.packages }),
      validate: ({ packages }) => (validatePackages(packages ?? []).find((r) => !r.valid) ?? ok()),
    },
  };

  const packageValidators = {
    length: validatePackageLength,
    width: validatePackageWidth,
    height: validatePackageHeight,
    weight: validatePackageWeight,
  };

  return {
    setLanguage,
    domain,
    fieldValidators,
    packageValidators,
    // v1-functienamen — voor de oracle-verify en directe consumptie
    fns: {
      validateShipperAddressCountry, validateRecipientAddressCountry,
      validateShipperAddressPostalCode, validateRecipientAddressPostalCode,
      validateShipperAddressStreet0_, validateShipperAddressStreet1_, validateShipperAddressCity,
      validateRecipientAddressStreet0_, validateRecipientAddressStreet1_, validateRecipientAddressCity,
      validateRecipientAddressRegion, validateShipperAddressPhoneNumber, validateRecipientAddressPhoneNumber,
      validateRecipientFirstName, validateRecipientLastName,
      validateShipperAddress, validateRecipientAddress,
      validatePackages, validatePackageLength, validatePackageWidth, validatePackageHeight, validatePackageWeight,
      validateShipmentOptionsTruckShipmentInfo,
    },
    // douane-grid-suite (§4: dit is DE ene strikte product-line-laag)
    gridFns: {
      validateProducts, validateItemDescription, validateItemWeight, validateItemValue,
      validateOriginCountry, validateHsCode,
      validateShipmentOptionsDescription, validateShipmentOptionsTotalShipmentValue,
      validateShipmentOptionsIncotermsGroupD, validateShipmentOptionsShipmentOriginCountry,
    },
  };
}
