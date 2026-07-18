export interface FullUserConfig {
  userId: string;
  webshops: Record<string, any>;
  language: Language;
  preferences?: any;
  createdAt: string;
  updatedAt: string;
}

export type Language = "EN" | "NL";

export type Currency = "EUR" | "USD" | "GBP" | "JPY" | "CNY" | "CHF";

export type InvoiceSource = "manual_upload" | "paperless";

export interface ShipmentInvoice {
  base64?: string;
  filename?: string;
  contentType?: string;
}

export interface PaperlessInvoiceFields {
  invoiceType?: "commercial_invoice" | "pro_forma_invoice";
  currency?: Currency;

  vatNumberShipper?: string;
  vatNumberConsignee?: string;
  eoriNumberShipper?: string;
  eoriNumberConsignee?: string;

  billingAddressDiffersFromDeliveryAddress?: boolean;
  billingAddress?: Address;

  paymentConditions?: string;

  carrier?: string;
  receiverReference?: string;
  remarks?: string;

  invoiceStatement?: {
    standard?: boolean;
    preferentialOrigin?: boolean;
    euri?: boolean;
    cites?: boolean;
  };

  declarantName?: string;
  declarantPosition?: string;
}

export interface ProductTemplate {
  sku: string;
  name?: string;
  description?: string;
  quantity?: number;
  weight: number;
  value: number;
  category?: string;
  currency: Currency;
  hsCode?: string;
  originCountry?: string;
  materials?: string[];
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
  packageAssignments?: PackageAssignment[];
}

export interface PackageTemplate {
  templateId: string;
  userId: string;
  name: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  type: "package" | "pallet" | "document";
  carrier?: string;
  originCountry?: string;
  hsCode?: string;
  stackable?: boolean;
  dangerousGoods: boolean;
  vehicle?: "car" | "box truck" | "lorry";
  bioGoods: boolean;
  createdAt: string;
  updatedAt: string;
  isFavorited?: boolean;
  sortOrder?: number;
}

export interface ShipmentTemplate {
  orderId: string;

  carrier?: string;
  pickupDate?: string;
  deliveryDate?: string;
  source: string;

  packages: PackageTemplate[];
  products?: ProductTemplate[];

  shipperAddress?: Address;
  recipientAddress?: Address;

  rates?: Rating[];
  ratesHash?: string;

  shipmentOptions?: ShipmentOptions;

  paperlessInvoice?: PaperlessInvoiceFields;

  invoice?: ShipmentInvoice;
  customsDocuments?: ShipmentInvoice[];
  invoiceSource?: InvoiceSource;
}

export interface TruckShipmentInformation {
  shipperVehicle?: "car" | "box truck" | "lorry";
  shipperForklift?: boolean;
  shipperTaillift?: boolean;
  recipientVehicle?: "car" | "box truck" | "lorry";
  recipientForklift?: boolean;
  recipientTaillift?: boolean;
}

export interface ShipmentOptions {
  invoiceRef?: string;
  description?: string;
  totalShipmentValue?: number;
  shipmentOriginCountry?: string;
  exportReason?:
    | "sale"
    | "retour"
    | "retour after repair"
    | "personal"
    | "sample"
    | "gift";

  vehicle?: "car" | "box truck" | "lorry";
  deliveryInstructions?: string;
  callBeforeDelivery?: boolean;

  registrationNumberTypeShipper?: string;
  registrationNumberShipper?: string;
  registrationNumberTypeRecipient?: string;
  registrationNumberRecipient?: string;

  recipientEORI?: string;
  recipientVAT?: string;

  // "ja"/"nee" radio (export only): is a commercial invoice included with the shipment?
  factuurAanwezig?: "ja" | "nee";

  exportDocument?: ShipmentInvoice;

  incotermsGroupB?: "FCA" | "FAS" | "FOB";
  incotermsGroupC?: "CFR" | "CIF" | "CPT" | "CIP";
  incotermsGroupD?: "DAP" | "DPU" | "DDP" | "EXW";

  truckShipmentInfo?: TruckShipmentInformation;
  signatureRequired: "direct" | "no_preference" | "adult" | "none";
  chosenRate?: Rating;
  /** Whether the chosen route supports paperless trade (PLT). Set by chooseOption from the
   *  TFF final page: true when the "Generate invoice for PLT" / file_invoice upload is offered,
   *  false when only customs docs (file_customs[]) are — i.e. the invoice must be printed. */
  paperlessAvailable?: boolean;
  insuranceValue?: number;
  carrierAccountNumber?: CarrierAccountNumber;
  customsBrokerEmail?: string;
  sessionKey: "";
}

export interface CarrierAccountNumber {
  specifyCarrierAccountNumber: boolean;
  carrierAccountNumber: string;
  carrierAccountNumberCountry: string;
  carrierAccountNumberPostalCode: string;
}

export interface Address {
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  street: string[];
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phoneNumber: string;
  // Explicit "particulier" flag (receiver-step radio). Absent = deduce from company.
  isPrivateIndividual?: boolean;
}

export interface Rating {
  carrier: string;
  service: string;
  serviceDescription?: string;
  price: string;
  imgUrl?: string;
  transitTime?: string;
  pickupDate?: string;
  pickupTime?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  carbonNeutral?: boolean;
  availablePickupDates?: PickupDate[];
  noPickupPossible?: boolean;
  reusableData: any;
  accessPoints?: AccessPoint[];

  fingerprint?: string;
  fingerprintKey?: string;
  fingerprintStatus?:
    | "approved"
    | "pending"
    | "unknown_fingerprint"
    | "missing";
}

export interface AccessPoint {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  chosen: boolean;
}

export interface PickupDate {
  date?: string;
  transitTime?: string;
}

export type ValidationResult = {
  valid: boolean;
  message?: string;
  path?: string;
  reason?:
    | "required"
    | "invalid_format"
    | "out_of_range"
    | "invalid"
    | string;
};

export interface Validator {
  dependsOn: (template: any) => any;
  validate: (fields: any) => ValidationResult | Promise<ValidationResult>;
}

export type PackageAssignment = {
  [sku: string]: Record<string, number>;
};

export type Package = {
  type: string;
  flags?: any;
  id: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  stackable?: boolean;
};

export type ReceiverProfile = {
  label: string;
  address: Address;
};

// Per-SKU learned product data (customs fields the user confirmed on earlier
// bookings). Stored server-side as `productProfiles::<userId>`; the widget
// reads it via /api/product-profiles/get to pre-fill the customs grid.
export type ProductProfile = {
  sku: string;
  name?: string;
  description?: string;
  hsCode?: string;
  originCountry?: string;
  weight?: number;
  value?: number;
  currency?: string;
  timesUsed?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PackageRuleMatcherType = "product" | "sku_wildcard" | "category";

export interface PackageRuleProductMatcher {
  type: "product";
  quantity: number;
  providerProductId?: string;
  sku?: string;
  name?: string;
}

export interface PackageRuleSkuWildcardMatcher {
  type: "sku_wildcard";
  quantity: number;
  pattern: string;
}

export interface PackageRuleCategoryMatcher {
  type: "category";
  quantity: number;
  categoryKey: string;
  categoryLabel: string;
}

export type PackageRuleMatcher =
  | PackageRuleProductMatcher
  | PackageRuleSkuWildcardMatcher
  | PackageRuleCategoryMatcher;

export interface PackageRule {
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchMode: "all";
  matchers: PackageRuleMatcher[];
  packageTemplateId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchableWebshopProduct {
  id: string;
  name: string;
  sku?: string;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  categoryKey?: string | null;
  categoryLabel?: string | null;
  rawCategories?: Array<{
    key: string;
    label: string;
  }>;
}

export interface SearchableWebshopCategory {
  id: string;
  name: string;
  categoryKey: string;
  categoryLabel: string;
}

export type AutomationFromType =
  | "shipper"
  | "receiver"
  | "shipment"
  | "product"
  | "product_group"
  | "always";

export type AutomationMatcherOperator =
  | "equals"
  | "wildcard"
  | "all_match";

export type ShipperMatcher =
  | {
      fromType: "shipper";
      field: "company";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "shipper";
      field: "country";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "shipper";
      field: "region";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "shipper";
      field: "postalCode";
      operator: "equals" | "wildcard";
      value: string;
    };

export type ReceiverMatcher =
  | {
      fromType: "receiver";
      field: "receiverProfile";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "receiver";
      field: "country";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "receiver";
      field: "region";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "receiver";
      field: "postalCode";
      operator: "equals" | "wildcard";
      value: string;
    };

export type ShipmentMatcher =
  | {
      fromType: "shipment";
      field: "source";
      operator: "equals";
      value: string;
    }
  | {
      fromType: "shipment";
      field: "hasInvoice";
      operator: "equals";
      value: boolean;
    }
  | {
      fromType: "shipment";
      field: "invoiceSource";
      operator: "equals";
      value: InvoiceSource;
    };

export type ProductMatcher =
  | {
      fromType: "product";
      field: "product";
      operator: "equals";
      providerId?: string;
      providerProductId?: string;
      sku?: string;
      name?: string;
      quantity?: number;
    }
  | {
      fromType: "product";
      field: "category";
      operator: "equals";
      providerId?: string;
      categoryKey: string;
      categoryLabel?: string;
      quantity?: number;
    }
  | {
      fromType: "product";
      field: "sku";
      operator: "wildcard";
      value: string;
      quantity?: number;
    }
  | {
      fromType: "product";
      field: "name";
      operator: "wildcard";
      value: string;
      quantity?: number;
    };

export interface ProductGroupMatcher {
  fromType: "product_group";
  field: "all";
  operator: "all_match";
  value: ProductMatcher[];
}

export type AutomationMatcher =
  | ShipperMatcher
  | ReceiverMatcher
  | ShipmentMatcher
  | ProductMatcher
  | ProductGroupMatcher;

export type AutomationToType =
  | "default_packages"
  | "product_hs_code"
  | "product_value"
  | "product_weight"
  | "product_origin_country"
  | "product_description"
  | "export_reason"
  | "total_shipment_value"
  | "shipment_origin_country"
  | "incoterm"
  | "description"
  | "delivery_instructions"
  | "call_before_delivery"
  | "signature_required"
  | "insurance_value"
  | "customs_broker_email"
  | "registration_number_type_shipper"
  | "registration_number_shipper"
  | "registration_number_type_recipient"
  | "registration_number_recipient"
  | "recipient_eori"
  | "recipient_vat"
  | "rate_selection"
  | "invoice_source"
  | "invoice_ref"
  | "factuur_aanwezig"
  | "paperless_invoice_field"
  | "paperless_invoice_statement_flag";

export type AutomationApplyLevel =
  | "shipment"
  | "matched_product"
  | "matched_products"
  | "all_products";

export type Incoterm =
  | "FCA"
  | "FAS"
  | "FOB"
  | "CFR"
  | "CIF"
  | "CPT"
  | "CIP"
  | "DAP"
  | "DPU"
  | "DDP"
  | "EXW";

export type RateSelectionRule =
  | { mode: "cheapest" }
  | { mode: "fastest" }
  | { mode: "cheapest_in_subset"; allowedFingerprints: string[] }
  | { mode: "fastest_in_subset"; allowedFingerprints: string[] }
  | {
      mode: "specific";
      fingerprintKey?: string;
      carrier?: string;
      service?: string;
    }
  | {
      // Priority-ordered list of candidates. The first one whose Mits conditions hold
      // wins; if none match, the outer rule yields no rateSelection and the engine
      // falls through to the next automation rule.
      mode: "fallback_chain";
      candidates: RateSelectionFallbackCandidate[];
    };

export type RateSelectionFallbackPick =
  | { mode: "specific"; carrier?: string; service?: string; fingerprintKey?: string }
  | { mode: "cheapest_in_subset"; allowedFingerprints: string[] }
  | { mode: "fastest_in_subset"; allowedFingerprints: string[] };

export type RateSelectionFallbackCondition =
  | { type: "available" }
  | { type: "transit_days"; op: "lte" | "gte" | "eq"; value: number }
  | { type: "price"; op: "lte" | "gte"; value: number };

export type RateSelectionFallbackCandidate = {
  pick: RateSelectionFallbackPick;
  conditions: RateSelectionFallbackCondition[];
};

export type AutomationAction =
  | {
      toType: "default_packages";
      applyLevel: "shipment";
      value: string[];
    }
  | {
      toType: "product_hs_code";
      applyLevel: "matched_product" | "matched_products" | "all_products";
      value: string;
    }
  | {
      toType: "product_value";
      applyLevel: "matched_product" | "matched_products" | "all_products";
      value: {
        amount: number;
        currency?: Currency;
      };
    }
  | {
      toType: "product_weight";
      applyLevel: "matched_product" | "matched_products" | "all_products";
      value: number;
    }
  | {
      toType: "product_origin_country";
      applyLevel: "matched_product" | "matched_products" | "all_products";
      value: string;
    }
  | {
      toType: "product_description";
      applyLevel: "matched_product" | "matched_products" | "all_products";
      value: string;
    }
  | {
      toType: "export_reason";
      applyLevel: "shipment";
      value: ShipmentOptions["exportReason"];
    }
  | {
      toType: "total_shipment_value";
      applyLevel: "shipment";
      value: number;
    }
  | {
      toType: "shipment_origin_country";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "incoterm";
      applyLevel: "shipment";
      value: Incoterm;
    }
  | {
      toType: "description";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "delivery_instructions";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "call_before_delivery";
      applyLevel: "shipment";
      value: boolean;
    }
  | {
      toType: "signature_required";
      applyLevel: "shipment";
      value: ShipmentOptions["signatureRequired"];
    }
  | {
      toType: "insurance_value";
      applyLevel: "shipment";
      value: number;
    }
  | {
      toType: "customs_broker_email";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "registration_number_type_shipper";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "registration_number_shipper";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "registration_number_type_recipient";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "registration_number_recipient";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "recipient_eori";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "recipient_vat";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "rate_selection";
      applyLevel: "shipment";
      value: RateSelectionRule;
    }
  | {
      toType: "invoice_source";
      applyLevel: "shipment";
      value: InvoiceSource;
    }
  | {
      toType: "invoice_ref";
      applyLevel: "shipment";
      value: string;
    }
  | {
      toType: "factuur_aanwezig";
      applyLevel: "shipment";
      value: "ja" | "nee";
    }
  | {
      toType: "paperless_invoice_field";
      applyLevel: "shipment";
      value: {
        field: keyof PaperlessInvoiceFields;
        fieldValue: any;
      };
    }
  | {
      toType: "paperless_invoice_statement_flag";
      applyLevel: "shipment";
      value: {
        field: keyof NonNullable<PaperlessInvoiceFields["invoiceStatement"]>;
        fieldValue: boolean;
      };
    };

export interface AutomationRule {
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: number;
  stopProcessing?: boolean;
  matchMode: "all" | "any";
  matchers: AutomationMatcher[];
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}

export type AutomationActionAllowedApplyLevels = Record<
  AutomationToType,
  AutomationApplyLevel[]
>;

export declare const automationActionAllowedApplyLevels: AutomationActionAllowedApplyLevels;

export type AutomationMatcherEditorType =
  | "shipper_company"
  | "shipper_country"
  | "shipper_region"
  | "shipper_postalCode"
  | "receiver_profile"
  | "receiver_country"
  | "receiver_region"
  | "receiver_postalCode"
  | "shipment_source"
  | "shipment_hasInvoice"
  | "shipment_invoiceSource"
  | "product"
  | "product_category"
  | "product_sku_wildcard"
  | "product_name_wildcard"
  | "product_group_all";

export type AutomationActionEditorType = AutomationToType;