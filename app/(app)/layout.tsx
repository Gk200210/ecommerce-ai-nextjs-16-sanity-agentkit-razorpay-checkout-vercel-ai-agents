
import { CartSheet } from '@/components/CartSheet'
import { Header } from '@/components/Header'
import { Toaster } from '@/components/ui/sonner'
import { CartStoreProvider } from '@/lib/store/cart-store-provider'
import { ChatStoreProvider } from '@/lib/store/chat-store-provider'
import { SanityLive } from '@/sanity/lib/live'
import { ClerkProvider } from '@clerk/nextjs'
import React from 'react'

function layout({children}: {children: React.ReactNode}) {
  return (
    <ClerkProvider>
      <CartStoreProvider>
        <ChatStoreProvider>
        <Header/>
      <main>{children}</main>
      <CartSheet/>
      <Toaster position='bottom-center'/>
      <SanityLive/> 
      </ChatStoreProvider>
     </CartStoreProvider>
    </ClerkProvider>
  )
}

export default layout
