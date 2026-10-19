import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import {parse, babelParse} from '@vue/compiler-sfc'
import moment from 'moment-timezone'

// Execute the component's real script; child components are not needed for these logic tests.
function loadComponent(path, globals = {}) {
	const {descriptor} = parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
	let script = descriptor.script.content
	const context = {moment, Element: class {}, setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args), ...globals}
	const imports = babelParse(script, {sourceType: 'module'}).program.body.filter(node => node.type === 'ImportDeclaration')
	for (const node of imports) {
		for (const specifier of node.specifiers) {
			if (specifier.local.name !== 'moment') context[specifier.local.name] = () => ({})
		}
	}
	for (const node of imports.reverse()) script = script.slice(0, node.start) + script.slice(node.end)
	return runInNewContext(script.replace('export default', 'const component =') + '\ncomponent', context)
}

for (const [start, end] of [['23:52:28.199', '00:22:28.199'], ['23:30:00.000', '00:30:00.000']]) {
	test(`midnight heading survives filtering for ${start} → ${end}`, () => {
		const grid = loadComponent('../src/components/GridSchedule.vue')
		const sessions = [
			{start: moment.utc(`2026-11-12T${start}`), end: moment.utc(`2026-11-13T${end}`)},
			{start: moment.utc('2026-11-13T10:00:00Z'), end: moment.utc('2026-11-13T10:30:00Z')}
		]
		const originalTimes = sessions.map(s => [s.start.valueOf(), s.end.valueOf()])
		const slices = grid.computed.timeslices.call({sessions, timeDensityMinutes: 30, timezone: 'UTC', occupiedDayKeys: new Set(['2026-11-12', '2026-11-13']), isProperSession: () => true})
		assert.equal(slices.filter(s => s.datebreak && s.date.format('YYYY-MM-DD') === '2026-11-13').length, 1)
		assert.equal(new Set(slices.map(s => s.name)).size, slices.length)
		assert.deepEqual(sessions.map(s => [s.start.valueOf(), s.end.valueOf()]), originalTimes)
		const heading = slices.findIndex(s => s.datebreak && s.date.format('YYYY-MM-DD') === '2026-11-13')
		assert.equal(slices[heading - 1].dayEnd, true)
	})
}

function positionFixture({tops, fullscreen = false, bottom = false, currentDay = '2026-11-12'}) {
	const window = {innerHeight: 600, scrollY: bottom ? 1400 : 500}
	const document = {documentElement: {scrollHeight: 2000}, body: {}}
	const scroller = {scrollTop: bottom ? 1400 : 500, clientHeight: 600, scrollHeight: 2000, getBoundingClientRect: () => ({top: 0, bottom: 600})}
	const headings = tops.map((top, index) => ({dataset: {sliceDay: `2026-11-${12 + index}`}, getBoundingClientRect: () => ({top})}))
	const changes = []
	const grid = loadComponent('../src/components/GridSchedule.vue', {window, document})
	const vm = {
		$el: {closest: () => fullscreen ? scroller : null, getBoundingClientRect: () => ({top: -900, bottom: 560}), querySelectorAll: () => headings},
		scrollParent: null, currentDay, getStickyHeaderClearance: () => 100,
		$emit: (event, day) => changes.push([event, day.format('YYYY-MM-DD')])
	}
	return {grid, vm, changes, headings, scroller}
}

test('heading positions track fast downward and upward scrolling without a scroll jump', () => {
	const {grid, vm, changes, headings} = positionFixture({tops: [-500, 80, 500]})
	grid.methods.syncActiveDay.call(vm)
	assert.deepEqual(changes.pop(), ['changeDay', '2026-11-13'])
	vm.currentDay = '2026-11-13'
	headings[0].getBoundingClientRect = () => ({top: 80})
	headings[1].getBoundingClientRect = () => ({top: 400})
	grid.methods.syncActiveDay.call(vm)
	assert.deepEqual(changes.pop(), ['changeDay', '2026-11-12'])
	assert.equal(vm._scrollDayUpdate, true)
})

for (const fullscreen of [false, true]) {
	test(`short last day is selected at the bottom (${fullscreen ? 'fullscreen' : 'normal'})`, () => {
		const {grid, vm, changes} = positionFixture({tops: [-800, -300, 160], bottom: true, fullscreen})
		grid.methods.syncActiveDay.call(vm)
		assert.deepEqual(changes, [['changeDay', '2026-11-14']])
	})
}

test('unchanged active day does not emit another selection update', () => {
	const {grid, vm, changes} = positionFixture({tops: [80, 400, 900]})
	grid.methods.syncActiveDay.call(vm)
	assert.equal(changes.length, 0)
})

test('day navigation scrolls the fullscreen container instead of the outer page', () => {
	const {grid, vm, scroller} = positionFixture({tops: [-500, 80, 500], fullscreen: true})
	grid.methods.scrollElementIntoViewWithClearance.call(vm, {getBoundingClientRect: () => ({top: 250})})
	assert.equal(scroller.scrollTop, 650)
})

test('lock expiry rechecks a day update ignored during rapid manual scrolling', t => {
	t.mock.timers.enable({apis: ['setTimeout']})
	const app = loadComponent('../src/App.vue')
	const {grid, vm, changes} = positionFixture({tops: [-800, -300, 160], bottom: true})
	const state = {currentDay: '2026-11-12', days: [12, 13, 14].map(day => moment.utc(`2026-11-${day}`)), $refs: {scheduleDisplay: {syncActiveDay: () => grid.methods.syncActiveDay.call(vm)}}}
	state.clearDayNavigationLock = app.methods.clearDayNavigationLock.bind(state)
	vm.$emit = (event, day) => {
		changes.push(day.format('YYYY-MM-DD'))
		app.methods.setCurrentDay.call(state, day)
	}
	app.methods.beginDayNavigation.call(state, '2026-11-12')
	grid.methods.syncActiveDay.call(vm)
	assert.equal(state.currentDay, '2026-11-12')
	t.mock.timers.tick(2000)
	assert.equal(state.currentDay, '2026-11-14')
	assert.equal(state.userNavigatingToDay, null)
	assert.equal(changes.length, 2)
})
