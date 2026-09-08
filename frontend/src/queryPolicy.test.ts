import {expect, it} from 'vitest';
import {retryQuery} from './queryPolicy';
it('reports invalid filters and authorization errors without retrying', () => {
  for (const status of [400,401,403,404,422]) expect(retryQuery(0, {status})).toBe(false);
});
it('still retries transient failures with a bounded count', () => {
  for (const error of [{status:408},{status:429},{status:500},new Error('offline')]) {
    expect(retryQuery(0,error)).toBe(true);
    expect(retryQuery(3,error)).toBe(false);
  }
});
