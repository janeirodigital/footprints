'use strict';

const Fse = require('fs-extra');
const Path = require('path');
const LdpConf = JSON.parse(Fse.readFileSync('./servers/config.json', 'utf-8')).LDP;
const TestRoot = LdpConf.documentRoot;
const H = require('../test-harness');
H.init(TestRoot);

installIn(LdpConf.shared);

function installIn (installDir) {
  describe(`test/apps/gh-deep.test.js installed in ${installDir}`, function () {
    before(() => H.ensureTestDirectory(installDir, TestRoot));

    describe('initial state', () => {
      H.find([
        // {path: '/', accept: 'text/turtle', entries: ['root']},
        {path: Path.join('/', installDir, '/'), accept: 'text/turtle', entries: [installDir]},
      ]);
      H.dontFind([
        {path: `${Path.join('/', installDir, '/')}Git/`, type: 'text/html', entries: ['Git']},
      ])
    });

    describe(`create ${Path.join('/', installDir, '/')}Git/`, () => {
      H.plant({path: Path.join('/', installDir, '/'), slug: 'Git', name: 'GhApp', url: 'http://store.example/gh', shapeTreePath: 'gh/ghShapeTree#root',
               status: 201, location: `${Path.join('/', installDir, '/')}Git/`});
      H.find([
        {path: `${Path.join('/', installDir, '/')}Git/`, accept: 'text/turtle', entries: ['shapeTreeInstancePath "."']},
      ])
    });

    describe(`create ${Path.join('/', installDir, '/')}Git/users/ericprud/`, () => {
      H.post({path: `${Path.join('/', installDir, '/')}Git/users/`, slug: 'ericprud', type: 'Container',
              body: 'test/apps/gh/ericprud-user.ttl', root: {'@id': '#ericprud'},
              parms: {userName: 'ericprud'}, location: `${Path.join('/', installDir, '/')}Git/users/ericprud/`});
      H.find([
        {path: `${Path.join('/', installDir, '/')}Git/users/ericprud/`, accept: 'text/turtle', entries: ['users/ericprud']},
        {path: `${Path.join('/', installDir, '/')}Git/users/ericprud/subscriptions/`, accept: 'text/turtle', entries: ['users/ericprud/subscriptions']},
      ]);
      H.dontFind([
        {path: `${Path.join('/', installDir, '/')}Git/users/ericprud/subscriptions/subscr1.ttl`, accept: 'text/turtle', entries: ['subscr1.ttl']},
        {path: `${Path.join('/', installDir, '/')}Git/users/ericprud-1/`, type: 'text/html', entries: ['ericprud-1']},
      ]);
      describe(`create ${Path.join('/', installDir, '/')}Git/users/ericprud/subscriptions/`, () => {
        H.post({path: `${Path.join('/', installDir, '/')}Git/users/ericprud/subscriptions/`, slug: 'subscr1.ttl',
                body: 'test/apps/gh/ericprud-subscr1.ttl', root: {'@id': '#subscr-1'},
                type: 'Resource', location: `${Path.join('/', installDir, '/')}Git/users/ericprud/subscriptions/subscr1.ttl`});
        H.find([
          {path: `${Path.join('/', installDir, '/')}Git/users/ericprud/subscriptions/subscr1.ttl`, accept: 'text/turtle', entries: ['subscription_url', 'updated_at']},
        ])
      })
    });

    describe(`create ${Path.join('/', installDir, '/')}Git/repos/ericprud/ hiearchy`, () => {
      describe(`create ${Path.join('/', installDir, '/')}Git/repos/ericprud/`, () => {
        H.post({path: `${Path.join('/', installDir, '/')}Git/repos/`, slug: 'ericprud', type: 'Container',
                body: 'test/apps/gh/ericprud-org.ttl', root: {'@id': '#ericprud'},
                parms: {userName: 'ericprud'}, location: `${Path.join('/', installDir, '/')}Git/repos/ericprud/`});
        H.find([
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/`, accept: 'text/turtle', entries: ['repos/ericprud']},
        ]);
        H.dontFind([
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud-1/`, type: 'text/html', entries: ['ericprud-1']},
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/`, accept: 'text/turtle', entries: ['repos/ericprud/jsg']},
        ]);
      })
      describe(`create ${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/`, () => {
        H.post({path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/`, slug: 'jsg',
                body: 'test/apps/gh/jsg.ttl', root: {'@id': '#jsg'},
                type: 'Container', location: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/`});
        H.find([
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/`, accept: 'text/turtle', entries: ['<> a ldp:BasicContainer']},
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/`, accept: 'text/turtle', entries: ['repos/ericprud/jsg/issues']},
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/labels/`, accept: 'text/turtle', entries: ['repos/ericprud/jsg/labels']},
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/milestones/`, accept: 'text/turtle', entries: ['repos/ericprud/jsg/milestones']},
        ]),
        H.dontFind([
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/1.ttl`, accept: 'text/turtle', entries: ['repos/ericprud/jsg/issues']},
        ]);
      })
      describe(`create ${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/1`, () => {
        H.post({path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/`, slug: '1.ttl',
                body: 'test/apps/gh/jsg-issue1.ttl', root: {'@id': '#issue1'},
                type: 'Resource', location: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/1.ttl`});
        H.find([
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/1.ttl`, accept: 'text/turtle', entries: ['gh:author_association \"OWNER\"']},
        ]),
        H.dontFind([
          {path: `${Path.join('/', installDir, '/')}Git/repos/ericprud/jsg/issues/2.ttl`, accept: 'text/turtle', entries: ['repos/ericprud/jsg/issues/2.ttl']},
        ]);
      })
    });
  })
}
