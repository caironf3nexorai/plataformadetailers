/**
 * Gerador de QR Code em Data URL de Imagem para Payloads Pix EMV
 * Utiliza o servico oficial de renderização de QR Code QuickChart / Google Charts ou Canvas
 */
export function gerarQrCodeUrl(payload: string): string {
  if (!payload) return '';
  const encoded = encodeURIComponent(payload);
  return `https://quickchart.io/qr?text=${encoded}&size=300&margin=1`;
}
