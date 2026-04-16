/**
 * Barrel for ruby language co-located files.
 * Importing this module ensures the extractor registers itself.
 */
import './extractor';

export { detect as detectExternal } from './external';
export { resolve } from './resolver';
