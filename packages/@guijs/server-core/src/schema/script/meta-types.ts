import { NpmScript } from '@/generated/schema'
import { MetaDocument } from '../db/meta-types'

export interface MetaNpmScript extends MetaDocument, Omit<NpmScript,
  'id' | 'status'
> {
  projectId: string
  workspaceId: string
  deleted?: boolean
}
