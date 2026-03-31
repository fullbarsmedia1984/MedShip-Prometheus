import type { Metadata } from 'next'
import { Poppins, Geist_Mono } from 'next/font/google'
import { Providers } from '@/components/providers'
import './globals.css'

const poppins = Poppins({
  variable: '--font-poppins',
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
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
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
