import PayClient from "./pay-client";

// Blocking route: the payer page reads the invoice per request (Next 16 cacheComponents).
export const instant = false;

export default function PayPage({ params }: { params: Promise<{ slug: string }> }) {
  return <PayClient params={params} />;
}
