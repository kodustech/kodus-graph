/**
 * Barrel for rust language co-located files.
 * Importing this module ensures the extractor registers itself.
 */
import './extractor';
import './noise';

export { detect as detectExternal } from './external';
export { resolve } from './resolver';
