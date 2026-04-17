import type { Metadata } from 'next'
import { Outfit, Geist_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import 'mapbox-gl/dist/mapbox-gl.css'
import './globals.css'

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'MedShip Prometheus',
  description: 'Integration hub for Salesforce, Fishbowl Inventory, and QuickBooks',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col font-sans">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
