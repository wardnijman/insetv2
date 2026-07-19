// Geport uit v1 src/lib/print/printPDFBinary.ts. Wijzigingen: geen. Volledig
// browser-only, maar alle DOM-toegang zit binnen de functie (SSR-veilig te importeren).

export function printPDFBinary(pdfBinary: ArrayBuffer) {
  const blob = new Blob([pdfBinary], { type: "application/pdf" });
  const pdfUrl = URL.createObjectURL(blob);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.inset = "0";
  iframe.style.width = "0";   // keep it invisible but present
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  iframe.src = pdfUrl;

  iframe.onload = function () {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();

    // optional cleanup after a minute
    // setTimeout(() => {
    //   document.body.removeChild(iframe);
    //   URL.revokeObjectURL(pdfUrl);
    // }, 60_000);
  };
}
