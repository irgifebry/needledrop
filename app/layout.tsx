import type { Metadata, Viewport } from 'next'
import { Anton, Work_Sans } from 'next/font/google'
import './globals.css'

const anton = Anton({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-anton',
  display: 'swap',
})

const workSans = Work_Sans({
  subsets: ['latin'],
  variable: '--font-work-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'),
  title: 'needledrop. Drop the needle on one track. Get the whole session.',
  description:
    'A YouTube Music playlist generator. Paste one track you love and get twenty more that belong with it. Metadata only, quota-aware, and every score explained.',
  applicationName: 'needledrop',
  openGraph: {
    title: 'needledrop. Drop the needle on one track. Get the whole session.',
    description:
      'Paste one track. Get a real playlist on your YouTube Music account. Quota-aware, explainable, metadata only.',
    type: 'website',
    siteName: 'needledrop',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'needledrop. Drop the needle on one track. Get the whole session.',
    description:
      'Paste one track. Get a real playlist on your YouTube Music account. Quota-aware, explainable, metadata only.',
  },
}

export const viewport: Viewport = {
  themeColor: '#ff6831',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-chapter="ink"
      className={`${anton.variable} ${workSans.variable}`}
      // The reveal gate below adds a class to <html> before React hydrates, so
      // the server and client class lists differ by one name. React cannot patch
      // that difference, so it is suppressed on this element only.
      suppressHydrationWarning
    >
      <head>
        {/* Marks that scripting is available, so the reveal animation may hide
            content before it runs. Without it, nothing is ever hidden. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
