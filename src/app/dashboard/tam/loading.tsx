import { Header } from '@/components/layout/Header'

export default function TamDashboardLoading() {
  return (
    <div className="flex flex-col">
      <Header title="Nursing TAM" />
      <main className="flex h-64 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground">Loading TAM overview...</div>
      </main>
    </div>
  )
}
