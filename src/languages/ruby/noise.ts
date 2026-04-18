import { registerNoise } from '../noise-registry';

/**
 * Ruby stdlib + common Rails framework names. Calls to these are almost always
 * builtin/framework, not user functions, and should not produce CALLS edges.
 */
export const RUBY_NOISE: ReadonlySet<string> = new Set([
    // Core
    'puts',
    'raise',
    'yield',
    'each',
    'do',
    'end',
    // Class DSL
    'attr_accessor',
    'attr_reader',
    'attr_writer',
    'respond_to',
    'new',
    'initialize',
    // Rails controllers
    'render',
    'redirect_to',
    'before_action',
    'after_action',
    // ActiveRecord associations + validations
    'validates',
    'has_many',
    'belongs_to',
    'has_one',
]);

registerNoise('ruby', RUBY_NOISE);
