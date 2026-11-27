// The decisions in spec/web.md, "Cluster": how the page groups skills and places them on the map, src/web/cluster.js,
// run as the page runs it, a classic script; the page itself in tests/web.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { MOCK_REPOSITORIES } from '../mock/github.ts';

type Skill = { name: string; description?: string };
type Clusters = {
  THRESHOLD: number;
  cluster: (skills: Skill[], threshold?: number) => { groups: { label: string[]; members: number[] }[]; others: number[]; points: [number, number][] };
  cosine: (a: Map<string, number>, b: Map<string, number>) => number;
  vectorize: (skills: Skill[]) => { vectors: Map<string, number>[] };
  words: (text: string) => string[];
  stem: (word: string) => string;
};

function load(): Clusters {
  const context: { SkillClusters?: Clusters } = {};
  vm.runInNewContext(readFileSync(new URL('../src/web/cluster.js', import.meta.url), 'utf8'), context);
  // Its arrays and maps made in this test's realm, so that deepEqual compares them with ours.
  const clusters = context.SkillClusters!;
  const here = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => structuredClone(fn(...args));
  return {
    THRESHOLD: clusters.THRESHOLD,
    cluster: here(clusters.cluster),
    cosine: clusters.cosine,
    vectorize: here(clusters.vectorize),
    words: here(clusters.words),
    stem: clusters.stem,
  };
}
const { THRESHOLD, cluster, cosine, vectorize, words, stem } = load();

const MOCK_SKILLS = MOCK_REPOSITORIES.flatMap((repository) => repository.skills);
const names = (indices: number[], skills: Skill[] = MOCK_SKILLS) => indices.map((i) => skills[i].name);

test('cluster: the words that count: lower case, no stopwords, no numbers alone, a plural as its singular', () => {
  assert.deepEqual(words('Use it when the 2 Gradle plugins are compiled, for Kotlin 2.1'), ['gradle', 'plugins', 'compiled', 'kotlin']);
  assert.deepEqual(['plugins', 'tests', 'libraries', 'class', 'status', 'analysis', 'docs'].map(stem), ['plugin', 'test', 'library', 'class', 'status', 'analysis', 'doc']);
});

test('cluster: TF-IDF vectors, each of length 1; the cosine of a skill with itself 1, with one sharing no word 0', () => {
  const { vectors } = vectorize([
    { name: 'gradle-build', description: 'Builds with Gradle.' },
    { name: 'gradle-test', description: 'Tests with Gradle.' },
    { name: 'release-notes', description: 'Drafts the release notes.' },
  ]);
  for (const vector of vectors) assert.ok(Math.abs(cosine(vector, vector) - 1) < 1e-9);
  assert.ok(cosine(vectors[0], vectors[1]) > 0);
  assert.equal(cosine(vectors[0], vectors[2]), 0);
  // A word in fewer skills weighs more: "build" against "gradle", in two.
  assert.ok(vectors[0].get('build')! > vectors[0].get('gradle')!);
});

test('cluster: the mock skills: Gradle and Koog skills in a group each, labelled by the words they share; the rest in none', () => {
  const result = cluster(MOCK_SKILLS);
  assert.equal(THRESHOLD, 0.12);
  assert.deepEqual(
    result.groups.map((group) => [group.label.join(' · '), names(group.members)]),
    [
      ['gradle · build · plugin', ['build-tools-bump-gradle-api', 'gradle-plugin-tests', 'mps-build']],
      ['koog · agent', ['koog-agent', 'koog-tests', 'koog-docs']],
    ],
  );
  assert.deepEqual(names(result.others), ['compiler-test-data', 'release-notes', 'stdlib-api-review', 'language-design']);
  // Each skill once.
  const all = [...result.groups.flatMap((group) => group.members), ...result.others].sort((a, b) => a - b);
  assert.deepEqual(all, MOCK_SKILLS.map((_, i) => i));
});

test('cluster: the largest group first; a lower threshold merges more, the highest none', () => {
  const loose = cluster(MOCK_SKILLS, 0.05);
  assert.deepEqual(names(loose.groups[0].members), ['build-tools-bump-gradle-api', 'compiler-test-data', 'gradle-plugin-tests', 'stdlib-api-review', 'mps-build']);
  for (let i = 1; i < loose.groups.length; i++) assert.ok(loose.groups[i - 1].members.length >= loose.groups[i].members.length);
  const strict = cluster(MOCK_SKILLS, 1.01);
  assert.deepEqual(strict.groups, []);
  assert.equal(strict.others.length, MOCK_SKILLS.length);
});

test('cluster: the map: a point for each skill, the same every time, similar skills closer than others', () => {
  const first = cluster(MOCK_SKILLS);
  assert.equal(first.points.length, MOCK_SKILLS.length);
  for (const point of first.points) assert.ok(point.every(Number.isFinite));
  // The same skills, the same groups and map: a fresh copy of the script, the same answer.
  assert.deepEqual(load().cluster(MOCK_SKILLS), first);
  const at = (name: string) => first.points[MOCK_SKILLS.findIndex((skill) => skill.name === name)];
  const distance = (a: string, b: string) => Math.hypot(at(a)[0] - at(b)[0], at(a)[1] - at(b)[1]);
  assert.ok(distance('koog-agent', 'koog-docs') < distance('koog-agent', 'mps-build'));
  assert.ok(distance('build-tools-bump-gradle-api', 'mps-build') < distance('build-tools-bump-gradle-api', 'koog-tests'));
});

test('cluster: no skills, one skill, skills with no words that count: no groups, nothing breaks', () => {
  assert.deepEqual(cluster([]), { groups: [], others: [], points: [] });
  assert.deepEqual(cluster([{ name: 'alone', description: 'Only one.' }]), { groups: [], others: [0], points: [[0, 0]] });
  const empty = cluster([{ name: 'a' }, { name: 'b', description: 'The.' }]);
  assert.deepEqual(empty.groups, []);
  assert.deepEqual(empty.others, [0, 1]);
  assert.deepEqual(empty.points, [[0, 0], [0, 0]]);
});

/** Many skills in many groups, as a large organization has: twelve topics of their own words, a few shared words. */
function manyTopics(): Skill[] {
  const topics = ['gradle build plugin compile', 'kotlin compiler diagnostic', 'release notes changelog', 'docker container image',
    'database migration schema', 'react component frontend', 'agent prompt llm', 'security audit vulnerability',
    'android emulator mobile', 'markdown site documentation', 'benchmark performance profile', 'git commit rebase'];
  const shared = ['update', 'run', 'check', 'review', 'project', 'code'];
  const skills: Skill[] = [];
  for (let i = 0; i < 96; i++) {
    const words = topics[i % topics.length].split(' ');
    const pick = (k: number) => words[(i * 7 + k * 3) % words.length];
    skills.push({ name: `${words[0]}-${pick(1)}-${i}`, description: `${pick(2)} ${pick(3)} ${shared[i % 6]} ${shared[(i * 5) % 6]} for the ${shared[(i + 2) % 6]}.` });
  }
  return skills;
}

/** Each group's disc on the map: its skills' middle and the farthest of them from it. */
function discs(result: ReturnType<typeof cluster>) {
  return result.groups.map(({ members }) => {
    const x = members.reduce((sum, i) => sum + result.points[i][0], 0) / members.length;
    const y = members.reduce((sum, i) => sum + result.points[i][1], 0) / members.length;
    return { x, y, radius: Math.max(...members.map((i) => Math.hypot(result.points[i][0] - x, result.points[i][1] - y))) };
  });
}

test('cluster: the map agrees with the groups: each group together, apart from the others, however many there are (#38)', () => {
  for (const skills of [MOCK_SKILLS, manyTopics()]) {
    const result = cluster(skills);
    const groupOf = new Map(result.groups.flatMap((group, g) => group.members.map((i) => [i, g] as const)));
    if (skills !== MOCK_SKILLS) assert.ok(result.groups.length >= 8, `${result.groups.length} groups`);
    // Each skill of a group: the nearest point to it is of its group.
    for (const [i, g] of groupOf) {
      let nearest = -1;
      for (let j = 0; j < skills.length; j++) {
        const d = (k: number) => Math.hypot(result.points[k][0] - result.points[i][0], result.points[k][1] - result.points[i][1]);
        if (j !== i && (nearest < 0 || d(j) < d(nearest))) nearest = j;
      }
      assert.equal(groupOf.get(nearest), g, `${skills[i].name}: nearest is ${skills[nearest].name}`);
    }
    // The groups' discs do not overlap, and a skill in no group is in no group's disc.
    const all = discs(result);
    for (let a = 0; a < all.length; a++) {
      for (let b = a + 1; b < all.length; b++) assert.ok(Math.hypot(all[a].x - all[b].x, all[a].y - all[b].y) > all[a].radius + all[b].radius);
      for (const i of result.others) assert.ok(Math.hypot(result.points[i][0] - all[a].x, result.points[i][1] - all[a].y) > all[a].radius);
    }
    assert.deepEqual(load().cluster(skills), result); // the same every time
  }
});

test('cluster: the map: copies of a skill in other repositories side by side, not one over the other', () => {
  const copy = { name: 'changelog', description: 'Updates the changelog from the latest release.' };
  const result = cluster([copy, copy, copy, { name: 'release-notes', description: 'Drafts the release notes of the latest release.' }]);
  assert.deepEqual(result.groups.map((group) => group.members.length), [4]);
  assert.equal(new Set(result.points.map((point) => point.join())).size, 4);
});
