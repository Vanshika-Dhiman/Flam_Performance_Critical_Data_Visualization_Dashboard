import 'server-only';
import { cache } from 'react';
import { CATEGORY_COUNT, INITIAL_POINTS, SAMPLE_INTERVAL_MS } from '@/lib/chartConfig';
import { generateHistory } from '@/lib/dataGenerator';
import { encodeColumnsBase64 } from '@/lib/encoding';
import type { InitialSnapshot } from '@/lib/types';

/**
 * Initial dataset for the Server Component. `cache` dedupes calls within one render pass;
 * the page itself is statically generated and revalidated (ISR), so this runs at build
 * time and then at most once per revalidation window — not per visitor.
 *
 * The payload is columnar Uint16 base64 (~54 KB for 10k points) plus the generator state,
 * so the client stream continues seamlessly from the last server-generated sample.
 */
export const getInitialSnapshot = cache(async (points: number = INITIAL_POINTS): Promise<InitialSnapshot> => {
  const generatedAt = Date.now();
  const history = generateHistory(points, generatedAt);
  const encoded = encodeColumnsBase64(history.values, history.requests);
  return {
    version: 1,
    rows: history.rows,
    categories: CATEGORY_COUNT,
    startTime: history.startTime,
    intervalMs: SAMPLE_INTERVAL_MS,
    values: encoded.values,
    requests: encoded.requests,
    generator: history.state,
    generatedAt,
  };
});
