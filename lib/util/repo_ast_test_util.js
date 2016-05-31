/*
 * Copyright (c) 2016, Two Sigma Open Source
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * * Redistributions of source code must retain the above copyright notice,
 *   this list of conditions and the following disclaimer.
 *
 * * Redistributions in binary form must reproduce the above copyright notice,
 *   this list of conditions and the following disclaimer in the documentation
 *   and/or other materials provided with the distribution.
 *
 * * Neither the name of git-meta nor the names of its
 *   contributors may be used to endorse or promote products derived from
 *   this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */
"use strict";

/**
 * @module {RepoASTTestUtil}
 *
 * This module provides utility functions for test drivers using `RepoAST`
 * objects.
 */

const assert  = require("chai").assert;
const co      = require("co");
const NodeGit = require("nodegit");

const RepoAST             = require("../../lib/util/repo_ast");
const RepoASTIOUtil       = require("../../lib/util/repo_ast_io_util");
const RepoASTUtil         = require("../../lib/util/repo_ast_util");
const ShorthandParserUtil = require("../../lib/util/shorthand_parser_util");
const TestUtil            = require("../../lib/util/test_util");

                         // Begin module-local methods

/**
 * Translate the specified `input` into a map from repo name to `RepoAST`.
 * `input` may be either a string to be parsed by
 * `ShorthandParserUtil.parseMultiRepoShorthand` or a map from repo name to
 * either a `RepoAST` object or a string to be parsed by
 * `ShorthandParserUtil.parseRepoShorthand`.
 *
 * @private
 * @param {String|Object} input
 * @return {Object} map from name to `RepoAST`
 */
function createMultiRepoASTMap(input) {
    if ("string" === typeof input) {
        return ShorthandParserUtil.parseMultiRepoShorthand(input);
    }
    assert.isObject(input);
    let result = {};
    for (let repoName in input) {
        let repoDef = input[repoName];
        if ("string" === typeof repoDef) {
            repoDef = ShorthandParserUtil.parseRepoShorthand(repoDef);
        }
        else {
            assert.instanceOf(repoDef, RepoAST);
        }
        result[repoName] = repoDef;
    }
    return result;
}

                          // End module-local methods

/**
 * Return the repository an object maps as returned by
 * `RepoASTIOUtil.writeRAST` as described by the specified `input`.  The value
 * of `input` may be a string parseable by
 * `ShorthandParserUtil.parseRepoShorthand`, or a `RepoAST` object.  The
 * behavior is undefined unless `TestUtil.cleanup` is called some time after
 * this method.
 */
exports.createRepo = co.wrap(function *(input) {
    let ast;
    if ("string" === typeof input) {
        ast = ShorthandParserUtil.parseRepoShorthand(input);
    }
    else {
        assert.instanceOf(input, RepoAST);
        ast = input;
    }
    const path = yield TestUtil.makeTempDir();
    return yield RepoASTIOUtil.writeRAST(ast, path);
});

/**
 * Create a repository described by the specified `input`, apply the specified
 * `manipulator` to it, then verify that it has the state described by the
 * specified `expected`.  The `manipulator` must return a map from IDs
 * in the repository to those described in `expectedShorthand`, or
 * `undefined` if no such mapping is required.  The behavior is undefined
 * unless `TestUtil.cleanup` is called some time after this method.  Both
 * `input` and `expected` may be either a string in the syntax accepted by
 * `parseRepoShorthand` or a `RepoAST` object.
 *
 * @param {String|RepoAST}  input
 * @param {String|RepoAST}  expectedShorthand
 * @param {(NodeGit.Repository) => Promise} manipulator
 */
exports.testRepoManipulator = co.wrap(function *(input,
                                                 expected,
                                                 manipulator) {
    if (!(expected instanceof RepoAST)) {
        assert.isString(expected);
        expected = ShorthandParserUtil.parseRepoShorthand(expected);
    }
    const written = yield exports.createRepo(input);
    const repo = written.repo;
    const userMap = yield manipulator(repo);
    if (undefined !== userMap) {
        Object.assign(written.commitMap, userMap);
    }
    const ast = yield RepoASTIOUtil.readRAST(repo);
    const actual = RepoASTUtil.mapCommitsAndUrls(ast, written.commitMap, {});
    RepoASTUtil.assertEqualASTs(actual, expected);
});

/**
 * Return the repository an objects and mappings returned by
 * `RepoASTIOUtil.writeMultiRAST` as described by the specified `input` map.
 * The values of `input` may be strings parseable by
 * `ShorthandParserUtil.parseRepoShorthand`, or `RepoAST` objects, or any mix
 * of the two.  The behavior is undefined unless `TestUtil.cleanup` is called
 * some time after this method.
 */
exports.createMultiRepos = co.wrap(function *(input) {
    const inputASTs = createMultiRepoASTMap(input);

    return yield RepoASTIOUtil.writeMultiRAST(inputASTs);
});

/**
 * Create the repositories described by the specified `input`, apply the
 * specified `manipulator` to them, then verify that the repositories are in
 * the specified `expected` state.  A few notes about some of the arguments:
 *
 * - `input` -- may be either a string that will be parsed by
 *   `ShorthandParserUtil.parseMultiRepoShorthand` or a map from repo name to
 *   either a string to be parsed by `ShorthandParserUtil.parseRepoShorthand`.
 * - `expected` -- has the same structural options as `input`.  Additionally,
 *   `expected` may describe new repositories that did not exist in the
 *   original input.  If a repo is omitted from `expected`, it is assumed to be
 *   required to be in its original state.
 * - `manipulator` -- Is passed a map from repo name to repo and may return an
 *   object containing:
 *      - `commitMap` -- specifying actual to logical mappings for new commits
 *      - `urlMap`    -- specifying repo name to path for new repos.  Note
 *                       that this is the opposite format returned by
 *                       `writeRAST` and expected by `mapCommitsAndUrls`.
 *   If it returns `undefined` then it is assumed no mapping is necessary.  The
 *   behvior is undefined if either map contains entries for commits or urls
 *   that already existed in the original map.
 *
 * @async
 * @param {String|Object}        input
 * @param {String|Object}        expected
 * @param {(repoMap) => Promise} manipulator
 */
exports.testMultiRepoManipulator =
                             co.wrap(function *(input, expected, manipulator) {
    const inputASTs = createMultiRepoASTMap(input);
    let expectedASTs = createMultiRepoASTMap(expected);

    // Add initial value of AST for those not specified in `expected`.

    for (let repoName in inputASTs) {
        if (!(repoName in expectedASTs)) {
            expectedASTs[repoName] = inputASTs[repoName];
        }
    }

    // Write the repos in their initial states.

    const written = yield RepoASTIOUtil.writeMultiRAST(inputASTs);
    const inputRepos = written.repos;
    let commitMap = written.commitMap;
    let urlMap    = written.urlMap;

    // Pass the repos off to the manipulator.

    const manipulated = yield manipulator(inputRepos);

    // Copy over and verify (that they are not duplicates) remapped commits and
    // urls output by the manipulator.

    if (undefined !== manipulated) {
        if ("commitMap" in manipulated) {
            assert.isObject(manipulated.commitMap);
            for (let commit in manipulated.commitMap) {
                assert.notProperty(commitMap, commit);
                commitMap[commit] = manipulated.commitMap[commit];
            }
        }
        if ("urlMap" in manipulated) {
            assert.isObject(manipulated.urlMap);
            for (let name in manipulated.urlMap) {
                const url = manipulated.urlMap[name];
                assert.notProperty(urlMap, url);
                urlMap[url] = name;
            }
        }
    }

    // Read in the states of the repos.

    let actualASTs = {};
    for (let repoName in expectedASTs) {
        let repo;

        // Load the repo if not loaded earlier.

        if (repoName in inputRepos) {
            repo = inputRepos[repoName];
        }
        else {
            assert.property(manipulated.urlMap, repoName);
            const path = manipulated.urlMap[repoName];
            repo = yield NodeGit.Repository.open(path);
        }
        const newAST = yield RepoASTIOUtil.readRAST(repo);
        actualASTs[repoName] = RepoASTUtil.mapCommitsAndUrls(newAST,
                                                             commitMap,
                                                             urlMap);
    }

    RepoASTUtil.assertEqualRepoMaps(actualASTs, expectedASTs);
});