import { Hero } from '@/components/hero'
import { Marquee } from '@/components/marquee'
import { Toaster } from '@/components/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Cta } from '@/components/sections/cta'
import { Faq } from '@/components/sections/faq'
import { Features } from '@/components/sections/features'
import { SiteFooter } from '@/components/sections/footer'
import { HowItWorks } from '@/components/sections/how-it-works'
import { Intro } from '@/components/sections/intro'
import { Showcase } from '@/components/sections/showcase'
import { Stats } from '@/components/sections/stats'

export default function HomePage() {
  return (
    <TooltipProvider>
      <main>
        <Hero />
        <Marquee />
        <Intro />
        <Features />
        <HowItWorks />
        <Showcase />
        <Stats />
        <Faq />
        <Cta />
      </main>
      <SiteFooter />
      <Toaster />
    </TooltipProvider>
  )
}
