// SUBMIT-laag-engine (route 2): bouwt uit de declaratieve bronconfig
// (submit-base + submit-variants + fingerprint-matrix + policies) dezelfde artefacten
// die v1's client-config-gen genereerde: widgetFieldsMatrix, per-variant
// veld-validators (dispatcher formId -> validator-map) en de matrix-pass-throughs.
// Semantiek 1-op-1 met v1's D_submitShipmentbase_0.validations (incl. de quirks:
// street-aggregaat krijgt het hele array, toevoeging uit houseNumberAddition,
// telefoon-fail zonder message, naam-checks vooraan) — bewaakt door de
// submit-oracle-fixtures (verify-widget-submit).

import {
  patternToRegex,
  generatePostalCodeExample,
} from "./validation-engine.ts";
import type { ValidationResult, FieldValidator, WidgetValidationRules } from "./validation-engine.ts";

type Reason = NonNullable<ValidationResult["reason"]>;

export interface SubmitBaseConfig {
  forceInAllVariants: string[];
  fields: Record<string, { source?: string; partial?: boolean; transform?: string }>;
}
export interface SubmitVariantsConfig {
  variants: Record<string, {
    fields: string[];
    /** CURATED: de extra-widget-velden van dit formulier (bron, reviewbaar).
     *  Indien afwezig (nieuwe variant uit ingest) wordt de lijst AFGELEID uit
     *  fields + partialPresent — dat is dan een VOORSTEL om te reviewen. */
    widgetFields?: string[];
    /** Capture-metadata voor het ingest-diff-pad. */
    partialPresent?: string[];
    presenceSource?: string;
  }>;
}

export interface SubmitLayerConfig {
  rules: WidgetValidationRules;
  domain: { countries: string[]; postalCodes: Record<string, string> };
  messages: Record<string, unknown>;
  base: SubmitBaseConfig;
  variantsCfg: SubmitVariantsConfig;
  fingerprintMatrix: Record<string, string>;
  additionalFieldPolicies: Record<string, unknown>;
}

// v1's toSafeFunctionName over een source-pad: niet-woordtekens -> underscore.
export function safeName(source: string): string {
  return source.replace(/\W/g, "_");
}

function getPathVal(obj: any, path: string): any {
  return path.split(".").reduce((acc, part) => acc?.[part], obj);
}

export function buildSubmitLayer(cfg: SubmitLayerConfig) {
  const { rules, domain, messages, base, variantsCfg, fingerprintMatrix, additionalFieldPolicies } = cfg;

  let currentLang = "NL";
  const setLanguage = (lang: string) => {
    if ((messages as any)[lang]) currentLang = lang;
  };
  const t = (key: string, params?: Record<string, any>): string => {
    const template = key.split(".").reduce((acc: any, part) => acc?.[part], (messages as any)[currentLang]);
    if (typeof template !== "string") return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  };
  const tD = (key: string, vars?: Record<string, any>) => t(`D_submitShipmentbase.validation.${key}`, vars);

  const ok = (): ValidationResult => ({ valid: true });
  const fail = (path: string, reason: Reason, message?: string): ValidationResult => ({ valid: false, message, path, reason });

  const MAX = rules.addressFieldMax;
  const NAME_TOTAL_MAX = rules.nameTotalMax;
  const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
  const normalizeCountry = (c?: string | null) => String(c ?? "").trim().toUpperCase();
  const isNonEUExportImport = (p: { shipperCountry?: string | null; recipientCountry?: string | null }): boolean => {
    const s = normalizeCountry(p.shipperCountry);
    const r = normalizeCountry(p.recipientCountry);
    if (!s || !r) return false;
    return !EU.includes(s) || !EU.includes(r);
  };
  const inRange = (v: number | null | undefined, min: number, max: number) => typeof v === "number" && v >= min && v <= max;

  // ---- D-suite (v1 D_submitShipmentbase-semantiek, tD-messages) -------------------
  function countryValidator(side: "shipper" | "recipient") {
    return (country: string): ValidationResult => {
      if (!country) return fail(`${side}.country`, "required", tD(`${side}.countryRequired`));
      if (!domain.countries.includes(country)) return fail(`${side}.country`, "unknown_value", tD(`${side}.unknownCountry`, { value: country }));
      return ok();
    };
  }
  function postalValidator(side: "shipper" | "recipient") {
    return (postalCode: string, country?: string): ValidationResult => {
      const path = `${side}.postalCode`;
      if (!country) {
        if (!postalCode) return fail(path, "required", tD("shipper.postalcodeRequired"));
        return ok();
      }
      const pattern = domain.postalCodes?.[country];
      if (!pattern) return ok();
      if (pattern === "geen") {
        if ((postalCode || "").length > rules.postalMaxNoFormat) return fail(path, "max_length", tD("shipper.postalcodeMax8"));
        return ok();
      }
      if (!postalCode) return fail(path, "required", tD("shipper.postalcodeFormatExample", { example: generatePostalCodeExample(pattern, country) }));
      const trimmed = postalCode.trim().replace(/\s+/g, " ");
      if (!patternToRegex(pattern, country).some((rx) => rx.test(trimmed))) {
        return fail(path, "invalid_format", tD("shipper.postalcodeFormatExample", { example: generatePostalCodeExample(pattern, country) }));
      }
      return ok();
    };
  }
  function street0Validator(side: "shipper" | "recipient") {
    return (street0: any): ValidationResult => {
      if (!street0) return fail(`${side}.street`, "required", tD(`${side}.streetRequired`));
      if (street0.length > MAX) return fail(`${side}.street`, "max_length", tD(`${side}.streetMaxLength`));
      return ok();
    };
  }
  function street1Validator(side: "shipper" | "recipient") {
    const path = side === "shipper" ? "shipperAddress.houseNumber" : "recipient.houseNumber";
    return (street1: any): ValidationResult => {
      if (street1?.length > MAX) return fail(path, "max_length", tD(`${side}.streetAdditionTooLong`));
      return ok();
    };
  }
  function cityValidator(side: "shipper" | "recipient") {
    return (city: string): ValidationResult => {
      if (!city) return fail(`${side}.city`, "required", tD(`${side}.cityRequired`));
      if (city.length > MAX) return fail(`${side}.city`, "max_length", tD(`${side}.cityMaxLength`));
      return ok();
    };
  }
  // v1 D-suite: telefoon-fail ZONDER message.
  const phoneValidator = (side: "shipper" | "recipient") => (phone: string): ValidationResult =>
    !phone ? fail(`${side}.phoneNumber`, "required") : ok();

  const dShipperCountry = countryValidator("shipper");
  const dRecipientCountry = countryValidator("recipient");
  const dShipperPostal = postalValidator("shipper");
  const dRecipientPostal = postalValidator("recipient");
  const dShipperStreet0 = street0Validator("shipper");
  const dRecipientStreet0 = street0Validator("recipient");
  const dShipperStreet1 = street1Validator("shipper");
  const dRecipientStreet1 = street1Validator("recipient");
  const dShipperCity = cityValidator("shipper");
  const dRecipientCity = cityValidator("recipient");
  const dShipperPhone = phoneValidator("shipper");
  const dRecipientPhone = phoneValidator("recipient");

  // Aggregaten — v1-quirks bewust behouden: street0 krijgt het HELE street-array,
  // de toevoeging komt uit houseNumberAddition/street2/addressLine2 (niet street[1]).
  function dValidateRecipientAddress(a: any): ValidationResult {
    const first = String(a?.firstName ?? "").trim();
    const last = String(a?.lastName ?? "").trim();
    if (!first) return fail("recipient.firstName", "required", tD("recipient.firstNameRequired"));
    if (!last) return fail("recipient.lastName", "required", tD("recipient.lastNameRequired"));
    if (first.length + last.length + 1 > NAME_TOTAL_MAX) return fail("recipient.firstName", "max_length", tD("recipient.nameMaxLength", { max: NAME_TOTAL_MAX }));
    const country = dRecipientCountry(String(a?.country ?? "").trim().toUpperCase());
    if (!country.valid) return country;
    const postal = dRecipientPostal(String(a?.postalCode ?? ""), String(a?.country ?? "").trim().toUpperCase());
    if (!postal.valid) return postal;
    const street = dRecipientStreet0(a?.street);
    if (!street.valid) return street;
    const addition = dRecipientStreet1(a?.houseNumberAddition ?? a?.street2 ?? a?.addressLine2);
    if (!addition.valid) return addition;
    const city = dRecipientCity(String(a?.city ?? ""));
    if (!city.valid) return city;
    const phone = dRecipientPhone(String(a?.phoneNumber ?? ""));
    if (!phone.valid) return phone;
    return ok();
  }
  function dValidateShipperAddress(a: any): ValidationResult {
    const first = String(a?.firstName ?? "").trim();
    const last = String(a?.lastName ?? "").trim();
    if (!first) return fail("shipper.firstName", "required");
    if (!last) return fail("shipper.lastName", "required");
    if (first.length + last.length + 1 > NAME_TOTAL_MAX) return fail("shipper.firstName", "max_length", tD("recipient.nameMaxLength", { max: NAME_TOTAL_MAX }));
    const country = dShipperCountry(String(a?.country ?? "").trim().toUpperCase());
    if (!country.valid) return country;
    const postal = dShipperPostal(String(a?.postalCode ?? ""), String(a?.country ?? "").trim().toUpperCase());
    if (!postal.valid) return postal;
    const street = dShipperStreet0(a?.street);
    if (!street.valid) return street;
    const addition = dShipperStreet1(a?.houseNumberAddition ?? a?.street2 ?? a?.addressLine2);
    if (!addition.valid) return addition;
    const city = dShipperCity(String(a?.city ?? ""));
    if (!city.valid) return city;
    const phone = dShipperPhone(String(a?.phoneNumber ?? ""));
    if (!phone.valid) return phone;
    return ok();
  }

  // Item/product/opties (D-suite; identiek aan de grid-suite maar hier zelfstandig
  // zodat de submit-laag geen afhankelijkheid op de widget-laag heeft).
  const hsRx = new RegExp(rules.productLine.hsPattern);
  const pl = rules.productLine;
  function dValidateProducts(products: any[]): ValidationResult[] {
    return products.map((product, i) => {
      const label = `Product ${i + 1}`;
      const basePath = `products[${i}]`;
      if (!product.description?.trim()) return fail(`${basePath}.description`, "required", tD("product.missingDescription", { label }));
      if (!product.hsCode || !hsRx.test(product.hsCode.replace(/[.\s]/g, ""))) return fail(`${basePath}.hsCode`, "invalid_format", tD("product.invalidHsCode", { label }));
      const quantity = product.packageAssignments?.reduce((total: number, assignment: any) => {
        const perSku = assignment[product.sku];
        return total + (perSku ? (Object.values(perSku) as number[]).reduce((a, b) => a + b, 0) : 0);
      }, 0) ?? 1;
      if (quantity <= 0) return fail(`${basePath}.quantity`, "out_of_range", tD("product.quantityTooLow", { label }));
      if (!product.originCountry || product.originCountry.length !== 2) return fail(`${basePath}.originCountry`, "invalid_format", tD("product.missingOrigin", { label }));
      if (product.weight <= 0) return fail(`${basePath}.weight`, "out_of_range", tD("product.weightTooLow", { label }));
      if (product.value <= 0) return fail(`${basePath}.value`, "out_of_range", tD("product.valueTooLow", { label }));
      if (!product.currency) return fail(`${basePath}.currency`, "required", tD("product.missingCurrency", { label }));
      return ok();
    });
  }
  function dValidatePackages(packages: any[]): ValidationResult[] {
    const lim = rules.packageLimits;
    return packages.map((pkg, i) => {
      const basePath = `packages[${i}]`;
      if (!pkg.type) return fail(`${basePath}.type`, "required", tD("package.missingType", { i: i + 1 }));
      const { length, width, height, weight } = pkg;
      if (!Object.keys(lim).includes(pkg.type)) return fail(`${basePath}.type`, "unknown_value", tD("package.unknownType", { type: pkg.type }));
      const p = lim.pallet, d = lim.document, k = lim.package;
      const dd = d.aggregateDims ?? d;
      if (pkg.type === "pallet") {
        if (!inRange(length, p.length[0], p.length[1]) || !inRange(width, p.width[0], p.width[1]) || !inRange(height, p.height[0], p.height[1]))
          return fail(basePath, "out_of_range", tD("package.palletDimsExceeded"));
        if (!inRange(weight, p.weight[0], p.weight[1])) return fail(`${basePath}.weight`, "out_of_range", tD("package.palletWeightExceeded"));
      } else if (pkg.type === "document") {
        if (!inRange(length, dd.length[0], dd.length[1]) || !inRange(width, dd.width[0], dd.width[1]) || !inRange(height, dd.height[0], dd.height[1]))
          return fail(basePath, "out_of_range", tD("package.docDimsExceeded"));
        if (!inRange(weight, d.weight[0], d.weight[1])) return fail(`${basePath}.weight`, "out_of_range", tD("package.docWeightExceeded"));
      } else {
        if (!inRange(length, k.length[0], k.length[1]) || !inRange(width, k.width[0], k.width[1]) || !inRange(height, k.height[0], k.height[1]))
          return fail(basePath, "out_of_range", tD("package.pkgDimsExceeded"));
        if (!inRange(weight, k.weight[0], k.weight[1])) return fail(`${basePath}.weight`, "out_of_range", tD("package.pkgWeightExceeded"));
      }
      return ok();
    });
  }
  const dDescription = (v: string): ValidationResult => {
    if (!v || v === "" || v.length < 1) return fail("shippingOptions.description", "required", tD("item.descriptionRequired"));
    if (v.length > rules.shipmentOptions.descriptionMax) return fail("shippingOptions.description", "max_length", tD("item.descriptionTooLong"));
    return ok();
  };
  const dInsurance = (v: number): ValidationResult =>
    v < 0 ? fail("shippingOptions.insuranceValue", "out_of_range", tD("insurance.valueMin")) : ok();
  const dTotalValue = (v: number, shipper: any, recipient: any): ValidationResult => {
    if (!isNonEUExportImport({ shipperCountry: shipper?.country, recipientCountry: recipient?.country })) return ok();
    if (v == null || Number(v) <= 0) return fail("shippingOptions.totalValue", "required", tD("item.valueRequired"));
    return ok();
  };
  const dIncoterm = (v: string, shipper: any, recipient: any): ValidationResult => {
    if (!isNonEUExportImport({ shipperCountry: shipper?.country, recipientCountry: recipient?.country })) return ok();
    if (v !== "DAP" && v !== "DDP" && v !== "EXW") return fail("shippingOptions.incoterm", "unknown_value", tD("shipmentOptions.incotermsGroupDInvalid"));
    return ok();
  };
  const dOriginCountry = (v: string, shipper: any, recipient: any): ValidationResult => {
    if (!isNonEUExportImport({ shipperCountry: shipper?.country, recipientCountry: recipient?.country })) return ok();
    const code = normalizeCountry(v);
    if (!code) return fail("shippingOptions.originCountry", "required", tD("item.originRequired"));
    if (!/^[A-Z]{2}$/.test(code)) return fail("shippingOptions.originCountry", "invalid_format", tD("item.originInvalid"));
    return ok();
  };

  // ---- source -> FieldValidator-registry ------------------------------------------
  const firstInvalidOf = (results: ValidationResult[]): ValidationResult => results.find((r) => !r.valid) ?? ok();
  const okValidator = (source: string): FieldValidator => ({
    dependsOn: (tpl) => ({ value: getPathVal(tpl, source) }),
    validate: () => ok(),
  });

  const registry: Record<string, FieldValidator> = {
    "shipmentOptions.description": {
      dependsOn: (tpl) => ({ v: tpl.shipmentOptions?.description }),
      validate: ({ v }) => dDescription(v),
    },
    "shipmentOptions.insuranceValue": {
      dependsOn: (tpl) => ({ v: tpl.shipmentOptions?.insuranceValue }),
      validate: ({ v }) => dInsurance(v),
    },
    "shipmentOptions.totalShipmentValue": {
      dependsOn: (tpl) => ({ v: tpl.shipmentOptions?.totalShipmentValue, s: tpl.shipperAddress, r: tpl.recipientAddress }),
      validate: ({ v, s, r }) => dTotalValue(v, s, r),
    },
    "shipmentOptions.incotermsGroupD": {
      dependsOn: (tpl) => ({ v: tpl.shipmentOptions?.incotermsGroupD, s: tpl.shipperAddress, r: tpl.recipientAddress }),
      validate: ({ v, s, r }) => dIncoterm(v, s, r),
    },
    "shipmentOptions.shipmentOriginCountry": {
      dependsOn: (tpl) => ({ v: tpl.shipmentOptions?.shipmentOriginCountry, s: tpl.shipperAddress, r: tpl.recipientAddress }),
      validate: ({ v, s, r }) => dOriginCountry(v, s, r),
    },
    products: {
      dependsOn: (tpl) => ({ products: tpl.products }),
      validate: ({ products }) => firstInvalidOf(dValidateProducts(products ?? [])),
    },
    packages: {
      dependsOn: (tpl) => ({ packages: tpl.packages }),
      validate: ({ packages }) => firstInvalidOf(dValidatePackages(packages ?? [])),
    },
    recipientAddress: {
      dependsOn: (tpl) => ({ a: tpl.recipientAddress }),
      validate: ({ a }) => dValidateRecipientAddress(a),
    },
    shipperAddress: {
      dependsOn: (tpl) => ({ a: tpl.shipperAddress }),
      validate: ({ a }) => dValidateShipperAddress(a),
    },
    // Per-veld adresvalidators (v1: eigen wrapper per source in de Validate-modules).
    "recipientAddress.country": {
      dependsOn: (tpl) => ({ v: tpl.recipientAddress?.country }),
      validate: ({ v }) => dRecipientCountry(v),
    },
    "recipientAddress.postalCode": {
      dependsOn: (tpl) => ({ v: tpl.recipientAddress?.postalCode, c: tpl.recipientAddress?.country }),
      validate: ({ v, c }) => dRecipientPostal(v, c),
    },
    "recipientAddress.street[0]": {
      dependsOn: (tpl) => ({ v: tpl.recipientAddress?.street?.[0] }),
      validate: ({ v }) => dRecipientStreet0(v),
    },
    "recipientAddress.street[1]": {
      dependsOn: (tpl) => ({ v: tpl.recipientAddress?.street?.[1] }),
      validate: ({ v }) => dRecipientStreet1(v),
    },
    "recipientAddress.city": {
      dependsOn: (tpl) => ({ v: tpl.recipientAddress?.city }),
      validate: ({ v }) => dRecipientCity(v),
    },
    "recipientAddress.phoneNumber": {
      dependsOn: (tpl) => ({ v: tpl.recipientAddress?.phoneNumber }),
      validate: ({ v }) => dRecipientPhone(v),
    },
    "shipperAddress.country": {
      dependsOn: (tpl) => ({ v: tpl.shipperAddress?.country }),
      validate: ({ v }) => dShipperCountry(v),
    },
    "shipperAddress.postalCode": {
      dependsOn: (tpl) => ({ v: tpl.shipperAddress?.postalCode, c: tpl.shipperAddress?.country }),
      validate: ({ v, c }) => dShipperPostal(v, c),
    },
    "shipperAddress.street[0]": {
      dependsOn: (tpl) => ({ v: tpl.shipperAddress?.street?.[0] }),
      validate: ({ v }) => dShipperStreet0(v),
    },
    "shipperAddress.street[1]": {
      dependsOn: (tpl) => ({ v: tpl.shipperAddress?.street?.[1] }),
      validate: ({ v }) => dShipperStreet1(v),
    },
    "shipperAddress.city": {
      dependsOn: (tpl) => ({ v: tpl.shipperAddress?.city }),
      validate: ({ v }) => dShipperCity(v),
    },
    "shipperAddress.phoneNumber": {
      dependsOn: (tpl) => ({ v: tpl.shipperAddress?.phoneNumber }),
      validate: ({ v }) => dShipperPhone(v),
    },
  };

  // ---- afleiding: widgetFieldsMatrix + validators per variant ---------------------
  const widgetFieldsMatrix: Record<string, string[]> = {};
  const validatorsByForm: Record<string, Record<string, FieldValidator>> = {};

  for (const [hash, variant] of Object.entries(variantsCfg.variants)) {
    // Dans-velden declaratief geforceerd (vervangt v1's handmatige partial-toggle).
    const fields = [...variant.fields];
    for (const forced of base.forceInAllVariants) if (!fields.includes(forced)) fields.push(forced);
    const partialPresent = new Set([...(variant.partialPresent ?? []), ...base.forceInAllVariants]);

    const extraKeys: string[] = [];
    const validators: Record<string, FieldValidator> = {};
    const seenSources = new Set<string>();

    for (const name of fields) {
      const desc = base.fields[name];
      const isInBase = name in base.fields;
      // v1-regel: extra widget-veld als het NIET in base zit, of een PARTIAL is dat
      // natief in dít formulier voorkomt (partialPresent uit de opname).
      const include = !isInBase || (desc?.partial === true && partialPresent.has(name));
      const source = desc?.source;
      if (!source) continue;

      if (include) {
        const key = safeName(source);
        if (!extraKeys.includes(key)) extraKeys.push(key);
      }
      // Dispatcher: één validator per distinct source (comma-split als v1).
      for (const s of source.split(",").map((x) => x.trim()).filter(Boolean)) {
        if (seenSources.has(s)) continue;
        seenSources.add(s);
        validators[safeName(s)] = registry[s] ?? okValidator(s);
      }
    }

    // Curated lijst wint; de afleiding is het voorstel-pad voor nieuwe varianten.
    widgetFieldsMatrix[hash] = variant.widgetFields ?? extraKeys;
    validatorsByForm[hash] = validators;
  }

  return {
    setLanguage,
    fingerprintMatrix,
    widgetFieldsMatrix,
    additionalFieldPolicies,
    validatorsByForm,
  };
}
