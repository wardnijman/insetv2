// Geport uit v1 src/lib/types/webshop.d.ts. Wijzigingen: geen.

export interface WebshopOrder {
    orderPlatform: string;
    orderId: string;
    orderStatus: string;
    createdAt: string;
    updatedAt: string;
    grandTotal: number;
    shippingAddress: WebshopAddress;
    billingAddress?: WebshopAddress;
    orderedItems: WebshopOrderedItem[];
    manuallyCreated: boolean;
    division?: string;
}

export interface WebshopAddress {
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
}

export interface WebshopOrderedItem {
  sku: string;
  name: string;
  description?: string;
  quantity: number;
  value: number;
  weight: string;
  imageUrl?: string;
  length: number;
  width: number;
  height: number;
  hsCode?: string;
  originCountry?: string;
  currency?: string;
}



export interface WebshopOrderShipmentInfo {
  status: 'CREATED' | 'CREATING' | 'LABEL_PRINTED' | 'UNPLANNED' | 'SHIPPED' | 'CANCELED' | 'FAILED';
  carrier?: string;
  country?: string;
  service?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  confirmationPdfUrl?: string;
  pdfUrl: string;
  forwarderRef?: string;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  printedAt: string | null;
  printBatchId: string | null;
  printEvents?: { at: string; by?: string; batchId?: string }[]; // optional audit trail
}


export type ShipReadinessStatus = "ready" | "no_rule" | "needs_input" | "error";

/**
 * Pre-rate headless preflight result, computed server-side during order sync.
 * Tells the UI (ahead of any TFF call) whether an order can be auto-shipped or
 * what's missing — surfaced as an "actie nodig" pill in the order row.
 */
export interface ShipReadiness {
    status: ShipReadinessStatus;
    reason?: string;
    missingFields?: string[];
}

export type EnrichedOrder = WebshopOrder & {
    shipment?: WebshopOrderShipmentInfo;
    shipReadiness?: ShipReadiness;
};
