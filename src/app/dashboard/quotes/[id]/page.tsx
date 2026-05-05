import { QuoteDetailClient } from './QuoteDetailClient'

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params

  return <QuoteDetailClient quoteId={id} />
}
