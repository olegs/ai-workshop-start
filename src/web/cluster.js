// Skill clusters for the web view: skills that say similar things, grouped, and a map of them in two dimensions.
// Computed in the page, from what was scanned: nothing fetched, no external service. A classic script, loaded by
// the page before its own; it defines `SkillClusters`.
//
// Each skill is a document: its name, its words counted twice, and its description. Each document a TF-IDF vector,
// its similarity to another the cosine of their angle. Average-linkage agglomerative clustering merges the two most
// similar groups while their average similarity is at least THRESHOLD; a skill similar to no other is in no group.
// The map: the first two principal components of the vectors. The same skills give the same groups and map.
var SkillClusters = (() => {
  /** Two groups merge while the average cosine similarity of their skills is at least this. */
  const THRESHOLD = 0.12;
  /** A group's label: its most telling words, at most this many. */
  const LABEL_WORDS = 3;

  /** Words that tell nothing about what a skill does. */
  const STOPWORDS = new Set(
    ('a about after again all also an and any are as at be been before being both but by can could do does done each ' +
      'for from had has have here how if in into is it its it\'s just may more most must no not now of on once one only ' +
      'or other our out over own same should so some such than that the their them then there these they this those ' +
      'through to too under until up very via was we were what when where which while who why will with within without ' +
      'would you your yours use used uses using skill skills md file files new first next every eg ie etc').split(' '),
  );

  /** The stem a word is counted under: a plural counts as its singular. */
  function stem(word) {
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
    return word;
  }

  /** The words of a text that count: lower case, letters and digits, no stopwords, no numbers alone. */
  function words(text) {
    return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (word) => word.length > 1 && !/^\d+$/.test(word) && !STOPWORDS.has(word),
    );
  }

  /** The terms of a skill, stemmed: its name's words twice, then its description's. */
  function terms(skill, surfaces) {
    const name = words(skill.name);
    const all = [...name, ...name, ...words(skill.description ?? '')];
    return all.map((word) => {
      const term = stem(word);
      if (surfaces) {
        const counts = surfaces.get(term) ?? new Map();
        counts.set(word, (counts.get(word) ?? 0) + 1);
        surfaces.set(term, counts);
      }
      return term;
    });
  }

  /** The TF-IDF vector of each skill, L2-normalized, as sparse `Map<term, weight>`; and the word each term shows as. */
  function vectorize(skills) {
    const surfaces = new Map();
    const documents = skills.map((skill) => terms(skill, surfaces));
    const frequency = new Map(); // in how many skills each term is
    for (const document of documents) for (const term of new Set(document)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
    const n = skills.length;
    const vectors = documents.map((document) => {
      const counts = new Map();
      for (const term of document) counts.set(term, (counts.get(term) ?? 0) + 1);
      const vector = new Map();
      let norm = 0;
      for (const [term, count] of counts) {
        // Sublinear term frequency, smoothed inverse document frequency.
        const weight = (1 + Math.log(count)) * (Math.log((1 + n) / (1 + frequency.get(term))) + 1);
        vector.set(term, weight);
        norm += weight * weight;
      }
      norm = Math.sqrt(norm);
      if (norm > 0) for (const [term, weight] of vector) vector.set(term, weight / norm);
      return vector;
    });
    // The word shown for a term: its most frequent form, the shorter one on a tie, then the first in order.
    const shown = new Map();
    for (const [term, counts] of surfaces) {
      const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))[0][0];
      shown.set(term, best);
    }
    return { vectors, shown, frequency };
  }

  /** The cosine similarity of two normalized vectors: their dot product. */
  function cosine(a, b) {
    if (a.size > b.size) [a, b] = [b, a];
    let sum = 0;
    for (const [term, weight] of a) {
      const other = b.get(term);
      if (other !== undefined) sum += weight * other;
    }
    return sum;
  }

  /** Average-linkage agglomerative clustering: the groups of indices whose average similarity is at least `threshold`. */
  function agglomerate(vectors, threshold) {
    const n = vectors.length;
    const sim = new Float32Array(n * n); // 4 bytes a pair: 100 MB for 5 000 skills
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) sim[i * n + j] = sim[j * n + i] = cosine(vectors[i], vectors[j]);
    }
    const members = Array.from({ length: n }, (_, i) => [i]);
    const active = new Set(members.keys());
    const best = new Int32Array(n).fill(-1); // each group's most similar other group
    const nearest = (i) => {
      let found = -1;
      for (const j of active) if (j !== i && (found < 0 || sim[i * n + j] > sim[i * n + found])) found = j;
      best[i] = found;
    };
    for (const i of active) nearest(i);
    for (;;) {
      let a = -1;
      for (const i of active) {
        if (best[i] >= 0 && (a < 0 || sim[i * n + best[i]] > sim[a * n + best[a]])) a = i;
      }
      if (a < 0 || sim[a * n + best[a]] < threshold) break;
      const b = best[a];
      const [keep, gone] = a < b ? [a, b] : [b, a];
      const sizeKeep = members[keep].length;
      const sizeGone = members[gone].length;
      active.delete(gone);
      for (const k of active) {
        if (k === keep) continue;
        const merged = (sizeKeep * sim[keep * n + k] + sizeGone * sim[gone * n + k]) / (sizeKeep + sizeGone);
        sim[keep * n + k] = sim[k * n + keep] = merged;
      }
      members[keep] = [...members[keep], ...members[gone]].sort((x, y) => x - y);
      members[gone] = [];
      for (const k of active) {
        if (k === keep || best[k] === keep || best[k] === gone) nearest(k);
        else if (sim[k * n + keep] > sim[k * n + best[k]]) best[k] = keep;
      }
    }
    return [...active].map((i) => members[i]);
  }

  /** A group's label: the words its skills share that weigh the most in them. */
  function label(group, vectors, shown) {
    const weight = new Map();
    const count = new Map();
    for (const i of group) {
      for (const [term, w] of vectors[i]) {
        weight.set(term, (weight.get(term) ?? 0) + w);
        count.set(term, (count.get(term) ?? 0) + 1);
      }
    }
    const shared = [...weight].filter(([term]) => count.get(term) > 1);
    return (shared.length ? shared : [...weight])
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, LABEL_WORDS)
      .map(([term]) => shown.get(term));
  }

  /** The first two principal components of the vectors, by power iteration from a fixed start: each skill's x and y.
   * Sparse: the vectors are not centered, their mean is taken out of each product instead, so a large organization's
   * thousands of skills and words cost their few words each, not skills × words. */
  function project(vectors) {
    const n = vectors.length;
    if (n === 0) return [];
    const index = new Map();
    for (const vector of vectors) for (const term of vector.keys()) if (!index.has(term)) index.set(term, index.size);
    const d = index.size;
    if (d === 0) return vectors.map(() => [0, 0]);
    const rows = vectors.map((vector) => [...vector].map(([term, weight]) => [index.get(term), weight]));
    const mean = new Float64Array(d);
    for (const row of rows) for (const [t, weight] of row) mean[t] += weight / n;
    const dot = (a, b) => {
      let sum = 0;
      for (let t = 0; t < a.length; t++) sum += a[t] * b[t];
      return sum;
    };
    /** (X − mean)·v: each skill's coordinate along v. */
    const along = (v) => {
      const shift = dot(mean, v);
      return rows.map((row) => {
        let sum = -shift;
        for (const [t, weight] of row) sum += weight * v[t];
        return sum;
      });
    };
    /** (X − mean)ᵀ(X − mean)·v: the covariance applied to v, up to a factor. */
    const times = (v) => {
      const xv = along(v);
      const out = new Float64Array(d);
      let total = 0;
      rows.forEach((row, i) => {
        for (const [t, weight] of row) out[t] += weight * xv[i];
        total += xv[i];
      });
      for (let t = 0; t < d; t++) out[t] -= mean[t] * total;
      return out;
    };
    const normalize = (v) => {
      const norm = Math.sqrt(dot(v, v));
      if (norm > 0) for (let t = 0; t < v.length; t++) v[t] /= norm;
      return norm;
    };
    const orthogonalize = (v, components) => {
      for (const previous of components) {
        const along = dot(v, previous);
        for (let t = 0; t < d; t++) v[t] -= along * previous[t];
      }
    };
    const components = [];
    for (let c = 0; c < 2; c++) {
      let v = Float64Array.from({ length: d }, (_, t) => 1 + Math.sin(t + 1 + c * 7) / 2);
      for (let step = 0; step < 200; step++) {
        orthogonalize(v, components);
        if (normalize(v) === 0) break;
        v = times(v);
      }
      orthogonalize(v, components);
      normalize(v);
      components.push(v);
    }
    const coordinates = components.map(along);
    // The same sign every time: the skill farthest along each axis on its positive side.
    for (const axis of coordinates) {
      let far = 0;
      for (const value of axis) if (Math.abs(value) > Math.abs(far)) far = value;
      if (far < 0) for (let i = 0; i < n; i++) axis[i] = -axis[i];
    }
    return vectors.map((_, i) => [round(coordinates[0][i]), round(coordinates[1][i])]);
  }

  const round = (value) => Math.round(value * 1e6) / 1e6 + 0; // + 0: no -0

  /**
   * The skills, `{ name, description }` each, in groups: `{ groups: [{ label: string[], members: number[] }],
   * others: number[], points: [x, y][] }`, the indices into `skills`. The groups by size, the largest first, then by
   * its first skill; a group's members in the order given; `others` the skills in no group, in the order given;
   * `points` each skill's place on the map.
   */
  function cluster(skills, threshold = THRESHOLD) {
    const { vectors, shown } = vectorize(skills);
    const all = agglomerate(vectors, threshold);
    const groups = all
      .filter((members) => members.length > 1)
      .map((members) => ({ label: label(members, vectors, shown), members }))
      .sort((a, b) => b.members.length - a.members.length || a.members[0] - b.members[0]);
    const others = all.filter((members) => members.length === 1).map(([i]) => i).sort((a, b) => a - b);
    return { groups, others, points: project(vectors) };
  }

  return { THRESHOLD, cluster, cosine, vectorize, words, stem };
})();
