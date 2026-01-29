import { type SchemaTypeDefinition } from 'sanity'
import { customerType } from './customerType'
import { orderType } from './orderType'
import { productType } from './productType'
import { categoryType } from './categoryType'
export const schema: { types: SchemaTypeDefinition[] } = {
  types: [
    categoryType,customerType,orderType,productType
    
  ],
}
