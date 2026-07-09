import type { KanbanJobRole } from './types'

export const KANBAN_ROLE_LABELS: Record<KanbanJobRole, string> = {
  ceo: 'CEO',
  coo: 'COO',
  territory_sales_rep: 'Territory Sales Rep',
  bdr: 'BDR',
  quotes_rep: 'Quotes Rep',
  warehouse_ops_manager: 'Warehouse Ops Manager',
  warehouse_staff: 'Warehouse Staff',
  it: 'IT',
  engineering: 'Engineering',
  customer_service: 'Customer Service',
  purchasing_manager: 'Purchasing Manager',
  ar: 'AR',
  ap: 'AP',
  hr: 'HR',
}

/** CEO + COO job roles carry command visibility over every board. */
export function isExecutiveJobRole(role: KanbanJobRole): boolean {
  return role === 'ceo' || role === 'coo'
}
