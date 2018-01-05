'use strict';

const { getBuildDir } = require('./util');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const groupBy = require('lodash.groupby');

const mkdir = promisify(fs.mkdir);
const readDir = promisify(fs.readdir);
const readFile = promisify(fs.readFile);

function daysToMs(days) {
  return 1000 * 60 * 60 * 24 * days;
}

function withInDays(a, b, days) {
  let aTime = +new Date(a.createdOn);
  let bTime = +new Date(b.createdOn);

  return aTime - bTime < daysToMs(days);
}

function withinLast(days, build) {
  const now = Date.now();
  let buildDateTime = +new Date(build.createdOn);
  let daysInMs = daysToMs(days);

  return buildDateTime > now - daysInMs;
}

function calculateGroup(builds) {
  let totalBuilds = builds.length;
  let totalDuration = 0;

  for (let build of builds) {
    totalDuration += build.duration;
  }

  let buildDurationMean = totalDuration / totalBuilds;

  return {
    totalBuilds,
    buildDurationMean,
  };
}

async function calculate({
    cwd,
  host,
  user,
  repo,
  branch = '*',
  period = 1,
  last = 30,
  }) {
  let buildsDir = await getBuildDir(cwd, host, user, repo);
  let files = await readDir(buildsDir);
  let builds = [];

  for (let fileName of files) {
    let filePath = path.join(buildsDir, fileName);
    let fileContents = await readFile(filePath);
    let build = JSON.parse(fileContents);
    builds.push(build);
  }

  // console.log(JSON.stringify(builds.map(build => build.trigger), null, 2));

  builds = builds.filter(build => {
    return build.trigger.name !== 'SCHEDULE';
  }).map(build => {
    return {
      id: build.build_number,
      uuid: build.uuid,
      createdOn: build.created_on,
      duration: build.duration_in_seconds,
      result: build.state.result.name,
      refType: build.target.ref_type,
      refName: build.target.ref_name,
    };
  });

  let sorted = builds.sort((a, b) => {
    return +new Date(b.createdOn) - +new Date(a.createdOn);
  });

  let queue = sorted.slice();

  // let json = {};

  let ranges = [];

  while (queue.length) {
    let range = [];
    let first = queue.shift();

    if (!withinLast(last, first)) {
      break;
    }

    range.push(first);

    while (queue[0] && withInDays(first, queue[0], period)) {
      range.push(queue.shift());
    }

    ranges.push(range);
  }

  let data = { ranges: [] };

  for (let range of ranges) {
    let rangeData = {};

    rangeData.ALL = calculateGroup(range);

    let groups = groupBy(range, build => build.result);

    for (let groupName of Object.keys(groups)) {
      rangeData[groupName] = calculateGroup(groups[groupName]);
    }

    data.ranges.push(rangeData);
  }

  // console.log(JSON.stringify(data, null, 2));

  // console.log(ranges[0].filter(build => build.result === 'SUCCESSFUL').map(build => ({ id: build.id, duration: build.duration / 60 })));
  // console.log(data.ranges[0]);
  // console.log(data.ranges.slice(0, 2));
  console.log(data.ranges.map(range => range.SUCCESSFUL && range.SUCCESSFUL.buildDurationMean / 60));

  // console.log(host, user, repo, branch, period, last);
}

module.exports = calculate;
