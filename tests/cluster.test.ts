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
