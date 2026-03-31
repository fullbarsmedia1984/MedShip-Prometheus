import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Automation } from './logger'

export interface FieldMapping {
  id: string
  automation: string
  source_field: string
  target_field: string
  transform?: string
  is_required: boolean
  default_value?: string
  notes?: string
}

/**
 * Field mapping engine that reads from field_mappings table
 */
class MappingEngine {
  private _supabase: SupabaseClient | null = null
  private cache: Map<string, FieldMapping[]> = new Map()
  private cacheExpiry: Map<string, number> = new Map()
  private cacheTTL = 5 * 60 * 1000 // 5 minutes

  // Lazy initialization to prevent build-time errors
  private get supabase(): SupabaseClient {
    if (!this._supabase) {
      this._supabase = createAdminClient()
    }
    return this._supabase
  }

  /**
   * Get field mappings for an automation
   */
  async getMappings(automation: Automation): Promise<FieldMapping[]> {
    // Check cache
    const now = Date.now()
    const expiry = this.cacheExpiry.get(automation)

    if (expiry && expiry > now) {
      const cached = this.cache.get(automation)
      if (cached) return cached
    }

    // Fetch from database
    const { data, error } = await this.supabase
      .from('field_mappings')
      .select('*')
      .eq('automation', automation)
      .order('source_field')

    if (error) {
      console.error('Failed to get field mappings:', error)
      return []
    }

    // Update cache
    this.cache.set(automation, data || [])
    this.cacheExpiry.set(automation, now + this.cacheTTL)

    return data || []
  }

  /**
   * Apply mappings to transform source data to target format
   */
  async applyMappings(
    automation: Automation,
    sourceData: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const mappings = await this.getMappings(automation)
    const result: Record<string, unknown> = {}

    for (const mapping of mappings) {
      // Get source value using dot notation
      let value = this.getNestedValue(sourceData, mapping.source_field)

      // Apply default if no value
      if (value === undefined || value === null) {
        if (mapping.is_required && !mapping.default_value) {
          throw new Error(`Required field missing: ${mapping.source_field}`)
        }
        value = mapping.default_value
      }

      // Apply transform if specified
      if (value !== undefined && mapping.transform) {
        value = this.applyTransform(value, mapping.transform)
      }

      // Set target value using dot notation
      if (value !== undefined) {
        this.setNestedValue(result, mapping.target_field, value)
      }
    }

    return result
  }

  /**
   * Get nested value from object using dot notation
   * e.g., "Account.ShippingStreet" -> obj.Account.ShippingStreet
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let current: unknown = obj

    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[part]
    }

    return current
  }

  /**
   * Set nested value on object using dot notation
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const parts = path.split('.')
    let current = obj

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (!(part in current)) {
        current[part] = {}
      }
      current = current[part] as Record<string, unknown>
    }

    current[parts[parts.length - 1]] = value
  }

  /**
   * Apply a transform to a value
   */
  private applyTransform(value: unknown, transform: string): unknown {
    const [transformName, ...args] = transform.split(':')

    switch (transformName.toLowerCase()) {
      case 'uppercase':
        return typeof value === 'string' ? value.toUpperCase() : value

      case 'lowercase':
        return typeof value === 'string' ? value.toLowerCase() : value

      case 'truncate':
        if (typeof value === 'string' && args[0]) {
          const maxLength = parseInt(args[0], 10)
          return value.length > maxLength
            ? value.substring(0, maxLength)
            : value
        }
        return value

      case 'trim':
        return typeof value === 'string' ? value.trim() : value

      case 'number':
        return typeof value === 'string' ? parseFloat(value) : value

      case 'integer':
        return typeof value === 'string' ? parseInt(value, 10) : value

      case 'boolean':
        if (typeof value === 'string') {
          return value.toLowerCase() === 'true' || value === '1'
        }
        return Boolean(value)

      case 'date':
        if (value instanceof Date) {
          return value.toISOString().split('T')[0]
        }
        if (typeof value === 'string') {
          return new Date(value).toISOString().split('T')[0]
        }
        return value

      case 'datetime':
        if (value instanceof Date) {
          return value.toISOString()
        }
        if (typeof value === 'string') {
          return new Date(value).toISOString()
        }
        return value

      case 'default':
        return value === undefined || value === null || value === ''
          ? args[0]
          : value

      case 'concat':
        // concat:prefix: or concat::suffix
        if (typeof value === 'string') {
          const prefix = args[0] || ''
          const suffix = args[1] || ''
          return `${prefix}${value}${suffix}`
        }
        return value

      default:
        console.warn(`Unknown transform: ${transformName}`)
        return value
    }
  }

  /**
   * Clear the mapping cache
   */
  clearCache(): void {
    this.cache.clear()
    this.cacheExpiry.clear()
  }
}

// Export singleton instance
export const mappingEngine = new MappingEngine()
