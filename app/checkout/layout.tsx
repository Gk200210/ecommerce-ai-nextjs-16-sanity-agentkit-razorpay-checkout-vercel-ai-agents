import { CartStoreProvider } from '@/lib/store/cart-store-provider'

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <CartStoreProvider>{children}</CartStoreProvider>
}
