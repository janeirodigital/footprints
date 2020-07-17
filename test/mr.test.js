'use strict';

const expect = require('chai').expect;
const Rdf = require('../shapetree.js/lib/rdf-serialization')
const Prefixes = require('../shapetree.js/lib/prefixes')
const Fs = require('fs')
const Path = require('path')
const N3 = require('n3');
const { namedNode, literal, defaultGraph, quad } = N3.DataFactory;
const LdpConf = JSON.parse(require('fs').readFileSync('./servers/config.json', 'utf-8')).LDP;
const Shared = LdpConf.shared;
const H = require('./test-harness');
const NS_gh = 'http://github.example/ns#';
H.init(LdpConf.documentRoot);
const testF = p => Path.join(__dirname, p)

describe(`apps, shapetrees and SKOS`, function () {
  before(() => H.ensureTestDirectory(Shared));

  let MrApp, MrShapeTree, DashShapeTree, MrShapeTreeSkos
  describe(`end-to-end`, () => {
    it (`parse App ID`, async () => {
      const appPrefixes = {}
      const appUrl = new URL('https://healthpad.example/id')
      MrApp = parseApplication(await Rdf.parseTurtle(Fs.readFileSync(testF('../solidApps/staticRoot/mr/mr-App.ttl'), 'utf8'), appUrl, appPrefixes))
      expect(flattenUrls(MrApp)).to.deep.equal(App1)
    })
    it (`parse med rec ShapeTree`, async () => {
      const stUrl = new URL('mr/mr-ShapeTree.ttl#medicalRecords', H.appStoreBase)
      MrShapeTree = await H.ShapeTree.RemoteShapeTree.get(stUrl)
      expect(flattenUrls(MrShapeTree.ids)).to.deep.equal(flattenUrls(MrShapeTreeIds1))
    })
    it (`parse dashboard ShapeTree`, async () => {
      const stUrl = new URL('mr/dashboard-ShapeTree.ttl#dashboards', H.appStoreBase)
      DashShapeTree = await H.ShapeTree.RemoteShapeTree.get(stUrl)
      expect(flattenUrls(DashShapeTree.ids)).to.deep.equal(flattenUrls(DashShapeTreeIds1))
    })
    it (`parse med rec ShapeTree SKOS`, async () => {
      const stSkosPrefixes = {}
      const stSkosUrl = new URL('mr/mr-ShapeTree-SKOS.ttl', H.appStoreBase)
      MrShapeTreeSkos = parseSkos(await Rdf.parseTurtle(Fs.readFileSync(testF('../solidApps/staticRoot/mr/mr-ShapeTree-SKOS.ttl'), 'utf8'), stSkosUrl, stSkosPrefixes))
      // expect(flattenUrls(MrShapeTreeSkos)).to.deep.equal(App1)
      console.warn(JSON.stringify(flattenUrls(MrShapeTreeSkos), null, 2))
    })
  });

  function flattenUrls (obj) {
    if (!obj) {
      return obj
    } else if (obj instanceof URL) {
      return '<' + obj.href + '>'
    } else if (obj instanceof Array) {
      return Object.keys(obj).reduce(
        (acc, key) => acc.concat(flattenUrls(obj[key])) , []
      )
    } else if (typeof obj === 'object') {
      return Object.keys(obj).reduce((acc, key) => {
        acc[key] = flattenUrls(obj[key])
        return acc
      }, {})
    } else {
      return obj
    }
  }

  const nn = (prefix, lname) => namedNode(Prefixes['ns_' + prefix] + lname)

  function visitNode (graph, rules, subjects, includeId) {
    return subjects.map(s => {
      const byPredicate = graph.getQuads(s, null, null).reduce((acc, q) => {
        const p = q.predicate.value
        if (!(p in acc))
          acc[p] = []
        acc[p].push(q.object)
        return acc
      }, {})
      const ret = includeId
            ? {'id': new URL(s.value)}
            : {}
      return rules.reduce((acc, rule) => {
        const p = rule.predicate
        if (p in byPredicate)
          acc[rule.attr] = rule.f(byPredicate[p], graph)
        return acc
      }, ret)
    })
  }

  const str = sz => one(sz).value
  const sht = sz => new URL(one(sz).value)
  const lst = sz => sz.map(s => new URL(s.value))
  const bol = sz => one(sz).value === 'true'
  const one = sz => sz.length === 1
        ? sz[0]
        : (() => {throw new Errors.ShapeTreeStructureError(this.url, `Expected one object, got [${sz.map(s => s.value).join(', ')}]`)})()

  function parseApplication (g) {
    const root = g.getQuads(null, nn('rdf', 'type'), nn('eco', 'Application'))[0].subject
    const cnt = (sz, g) => {
      return 1
    }
    const grp = (sz, g) => visitNode(g, needGroupRules, sz, true)
    // const ned = (sz, g) => visitNode(g, accessNeedRules, sz, true)
    const ned = (sz, g) => visitNode(g, accessNeedRules, sz, true)
    const accessNeedRules = [
      { predicate: Prefixes.ns_eco + 'inNeedSet'    , attr: 'inNeedSet'    , f: lst },
      { predicate: Prefixes.ns_eco + 'requestedAccessLevel', attr: 'requestedAccessLevel', f: sht },
      { predicate: Prefixes.ns_tree + 'hasShapeTree' , attr: 'hasShapeTree' , f: sht },
      { predicate: Prefixes.ns_eco + 'recursivelyAuthorize', attr: 'recursivelyAuthorize', f: bol },
      { predicate: Prefixes.ns_eco + 'requestedAccess', attr: 'requestedAccess', f: cnt },
    ]
    const needGroupRules = [
      { predicate: Prefixes.ns_eco + 'requestsAccess', attr: 'requestsAccess', f: ned },
      { predicate: Prefixes.ns_eco + 'authenticatesAsAgent', attr: 'authenticatesAsAgent', f: sht },
    ]
    const applicationRules = [
      { predicate: Prefixes.ns_eco + 'applicationDescription', attr: 'applicationDescription', f: str },
      { predicate: Prefixes.ns_eco + 'applicationDevelopedBy', attr: 'applicationDevelopedBy', f: str },
      { predicate: Prefixes.ns_eco + 'authorizationCallback' , attr: 'authorizationCallback' , f: sht },
      { predicate: Prefixes.ns_eco + 'applicationAccessSkosIndex' , attr: 'applicationAccessSkosIndex' , f: sht },
      { predicate: Prefixes.ns_eco + 'groupedAccessNeeds'  , attr: 'groupedAccessNeeds'  , f: grp },
    ]

    const ret = visitNode(g, applicationRules, [root], true)[0]
    ret.groupedAccessNeeds.forEach(grpd => {
    grpd.byShapeTree = {}
    const needsId = grpd.id.href
    grpd.requestsAccess.forEach(req => { grpd.byShapeTree[req.id.href] = req })
    const requestsAccess = grpd.requestsAccess.map(req => req.id.href)
    g.getQuads(null, nn('eco', 'inNeedSet'), namedNode(needsId))
      .map(q => q.subject.value)
      .filter(n => requestsAccess.indexOf(n) === -1)
      .forEach(n => {
        grpd.byShapeTree[n] = ned([namedNode(n)], g)[0]
      })
    })
    return ret
  }

  function parseSkos (g) {
    const labelNodes = g.getQuads(null, nn('rdf', 'type'), nn('tree', 'ShapeTreeLabel')).map(q => q.subject)

    const labelRules = [
      { predicate: Prefixes.ns_skos + 'inScheme', attr: 'inScheme', f: sht },
      { predicate: Prefixes.ns_tree + 'treeStep' , attr: 'treeStep' , f: sht },
      { predicate: Prefixes.ns_skos + 'prefLabel', attr: 'prefLabel', f: str },
      { predicate: Prefixes.ns_skos + 'definition', attr: 'definition', f: str },
    ]

    const labels = labelNodes.map(label => visitNode(g, labelRules, [label], true)[0])
    const byScheme = labels.reduce((acc, label) => {
      const scheme = label.inScheme.href
      if (!(scheme in acc))
        acc[scheme] = []
      acc[scheme].push(label)
      return acc
    }, {})
    const byShapeTree = labels.reduce((acc, label) => {
      const shapeTree = label.treeStep.href
      acc[shapeTree] = label
      return acc
    }, {})
    return { byScheme, byShapeTree }
  }

  if (false) describe('shapetree navigation', function () {
    H.walkReferencedTrees({
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#org', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      control: 0xF,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "contains", "target": "#org" },
          "via": [ ] },
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      control: 0x5,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "contains", "target": "#org" },
          "via": [ ] }
      ]
    });
    H.walkReferencedTrees({
      control: 0xD,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "contains", "target": "#org" },
          "via": [ ] }
      ]
    });
    H.walkReferencedTrees({
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree-split-org#org', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat-ShapeTree-split-issues#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#comment", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#comment>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "gh-flat-ShapeTree-split-issues#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#event", "shapePath": "@<gh-flat-Schema#IssueShape>/<http://github.example/ns#event>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
                   { "type": "reference", "target": { "treeStep": "gh-flat-ShapeTree-split-issues#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [2, 0x3],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#labels", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#label>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#milestones", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#milestone>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [1, 0x3],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [0, 0x3],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] }
      ]
    });
    H.walkReferencedTrees({
      depth: [2, 0],
      control: undefined,
      path: 'gh-flat/gh-flat-ShapeTree#orgs', expect: [
        { "result": { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" } ] },
        { "result": { "type": "reference", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": "#org", "type": "contains" },
                   { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
    });
    H.walkReferencedResources({
      prefixes: {"st": "gh-flat/gh-flat-ShapeTree#repos"},
      control: undefined,
      focus: `/${Shared}/Git-Users/ericprud.ttl#ericprud`, expect: [
        { "result": {
            "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
              "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#repository>" },
            "resource": "/Data/Git-Repos/jsg.ttl#jsg" },
          "via": [] },
        { "result": {
            "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#issue",
              "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" },
            "resource": "/Data/Git-Issues/issue1.ttl" },
          "via": [
            { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
                "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#repository>" },
              "resource": "/Data/Git-Repos/jsg.ttl#jsg" }
          ] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
              "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#repository>" },
            "resource": "/Data/Git-Repos/libxml-annot.ttl#libxml-annot" },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
              "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#subscription>" },
            "resource": "/Data/Git-Repos/jsg.ttl#jsg" },
          "via": [] },
        { "result": { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#issue",
              "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" },
            "resource": "/Data/Git-Issues/issue1.ttl" },
          "via": [
            { "type": "reference", "target": { "treeStep": "gh-flat/gh-flat-ShapeTree#repo",
                "shapePath": "@<gh-flat-Schema#UserShape>/<http://github.example/ns#subscription>" },
              "resource": "/Data/Git-Repos/jsg.ttl#jsg" }
          ] }
      ]
      /*
      [
        { "result": { "type": "reference", "target": "../Git-Orgs/shapetrees.ttl" },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] },
        { "result": { "type": "resource", "target": { "treeStep": "#issue", "shapePath": "@<gh-flat-Schema#RepoShape>/<http://github.example/ns#issue>" } },
          "via": [ { "type": "reference", "target": { "treeStep": "#repo", "shapePath": "@<gh-flat-Schema#OrgShape>/<http://github.example/ns#repo>" } } ] }
      ]
      */
    });
  });

});

const App1 = {
  "id": "<https://healthpad.example/id#agent>",
  "applicationDescription": "Health!",
  "applicationDevelopedBy": "HealthDev.co",
  "authorizationCallback": "<https://healthpad.example/callback>",
  "applicationAccessSkosIndex": "<https://healthpad.example/healthpad-skos-index.ttl>",
  "groupedAccessNeeds": [
    {
      "id": "<https://healthpad.example/id#general>",
      "requestsAccess": [
        {
          "id": "<https://healthpad.example/id#medical-record-r>",
          "inNeedSet": [
            "<https://healthpad.example/id#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<https://healthpad.example/MedicalRecord.jsonld#medicalrecords>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        },
        {
          "id": "<https://healthpad.example/id#dashboard-r>",
          "inNeedSet": [
            "<https://healthpad.example/id#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<http://dashboard.example/shapetrees#dashboards>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        }
      ],
      "authenticatesAsAgent": "<acl:Pilot>",
      "byShapeTree": {
        "https://healthpad.example/id#medical-record-r": {
          "id": "<https://healthpad.example/id#medical-record-r>",
          "inNeedSet": [
            "<https://healthpad.example/id#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<https://healthpad.example/MedicalRecord.jsonld#medicalrecords>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        },
        "https://healthpad.example/id#dashboard-r": {
          "id": "<https://healthpad.example/id#dashboard-r>",
          "inNeedSet": [
            "<https://healthpad.example/id#general>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<http://dashboard.example/shapetrees#dashboards>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        },
        "https://healthpad.example/id#patient-rw": {
          "id": "<https://healthpad.example/id#patient-rw>",
          "inNeedSet": [
            "<https://healthpad.example/id#general>",
            "<https://healthpad.example/id#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<https://healthpad.example/MedicalRecord.jsonld#patients>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        }
      }
    },
    {
      "id": "<https://healthpad.example/id#med-management>",
      "requestsAccess": [
        {
          "id": "<https://healthpad.example/id#prescriptions-rw>",
          "inNeedSet": [
            "<https://healthpad.example/id#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<https://healthpad.example/MedicalRecord.jsonld#prescriptions>",
          "recursivelyAuthorize": false,
          "requestedAccess": 1
        }
      ],
      "authenticatesAsAgent": "<acl:Pilot>",
      "byShapeTree": {
        "https://healthpad.example/id#prescriptions-rw": {
          "id": "<https://healthpad.example/id#prescriptions-rw>",
          "inNeedSet": [
            "<https://healthpad.example/id#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<https://healthpad.example/MedicalRecord.jsonld#prescriptions>",
          "recursivelyAuthorize": false,
          "requestedAccess": 1
        },
        "https://healthpad.example/id#patient-rw": {
          "id": "<https://healthpad.example/id#patient-rw>",
          "inNeedSet": [
            "<https://healthpad.example/id#general>",
            "<https://healthpad.example/id#med-management>"
          ],
          "requestedAccessLevel": "<http://www.w3.org/ns/solid/ecosystem#Required>",
          "hasShapeTree": "<https://healthpad.example/MedicalRecord.jsonld#patients>",
          "recursivelyAuthorize": true,
          "requestedAccess": 1
        }
      }
    }
  ]
}

const MrShapeTreeIds1 = {
  "http://localhost:12345/mr/mr-ShapeTree.ttl#medicalRecords": {
    "@context": "../ns/shapeTreeContext",
    "@id": "<http://localhost:12345/mr/mr-ShapeTree.ttl#medicalRecords>",
    "contents": [
      {
        "@id": "<http://localhost:12345/mr/mr-ShapeTree.ttl#medicalRecord>",
        "uriTemplate": "{id}",
        "references": [
          {
            "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#patient>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:patient"
          },
          {
            "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#appointment>",
            "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
          },
          {
            "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#condition>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
          },
          {
            "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#prescription>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
          },
          {
            "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#allergie>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:allergy"
          },
          {
            "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#diagnosticTest>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
          }
        ]
      }
    ],
    "references": [
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#patients>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#appointments>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#conditions>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#prescriptions>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#diagnosticTests>"
      }
    ]
  },
  "http://localhost:12345/mr/mr-ShapeTree.ttl#medicalRecord": {
    "@id": "<http://localhost:12345/mr/mr-ShapeTree.ttl#medicalRecord>",
    "uriTemplate": "{id}",
    "references": [
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#patient>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:patient"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#appointment>",
        "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#condition>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#prescription>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#allergie>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:allergy"
      },
      {
        "treeStep": "<http://localhost:12345/mr/mr-ShapeTree.ttl#diagnosticTest>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
      }
    ]
  }
}

const DashShapeTreeIds1 = {
  "http://localhost:12345/mr/dashboard-ShapeTree.ttl#dashboards": {
    "@context": "../ns/shapeTreeContext",
    "@id": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#dashboards>",
    "expectedType": "<http://www.w3.org/ns/ldp#Container>",
    "contents": [
      {
        "@id": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#dashboard>",
        "uriTemplate": "{id}",
        "references": [
          {
            "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-appointment>",
            "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
          },
          {
            "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-condition>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
          },
          {
            "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-prescription>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
          },
          {
            "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-allergie>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:allergy"
          },
          {
            "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-diagnosticTest>",
            "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
          }
        ]
      }
    ],
    "references": [
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-appointments>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-conditions>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-prescriptions>"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-diagnosticTests>"
      }
    ]
  },
  "http://localhost:12345/mr/dashboard-ShapeTree.ttl#dashboard": {
    "@id": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#dashboard>",
    "uriTemplate": "{id}",
    "references": [
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-appointment>",
        "shapePath": "<@medrecord-schema#medicalRecord>/medrecord:appointment"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-condition>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:condition"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-prescription>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:prescription"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-allergie>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:allergy"
      },
      {
        "treeStep": "<http://localhost:12345/mr/dashboard-ShapeTree.ttl#temporal-diagnosticTest>",
        "shapePath": "@<medrecord-schema#medicalRecord>/medrecord:diagnosticTest"
      }
    ]
  }
}

