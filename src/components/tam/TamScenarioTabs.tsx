'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TamScenario } from '@/lib/tam/supabase'

const SCENARIOS: Array<{ value: TamScenario; label: string }> = [
  { value: 'base', label: 'Base' },
  { value: 'low', label: 'Low' },
  { value: 'high', label: 'High' },
]

export function TamScenarioTabs({ scenario }: { scenario: TamScenario }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Tabs
      value={scenario}
      onValueChange={(value: string) => {
        startTransition(() => {
          router.push(`/dashboard/tam?scenario=${value}`)
        })
      }}
    >
      <TabsList aria-label="TAM scenario">
        {SCENARIOS.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            disabled={pending}
            className="min-w-16"
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
