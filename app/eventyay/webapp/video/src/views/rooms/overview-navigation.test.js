/**
 * Run from the video app: node --test src/views/rooms/overview-navigation.test.js
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

for (const component of ['RoomHeader.vue', 'manage.vue']) {
	const source = readFileSync(new URL(component, import.meta.url), 'utf8')
	// Load the actual handler without mounting unrelated video and websocket components.
	const handler = source.match(/^\t\tonBack\(\) \{[\s\S]*?^\t\t\}/m)
	assert.ok(handler, `${component} must expose its back-button handler`)

	for (const [area, eventyay, expected] of [
		['organizer', { isOrganizerArea: true }, 'organizer'],
		['attendee', { isOrganizerArea: false }, 'about'],
		['missing page configuration', undefined, 'about'],
	]) {
		for (const previous of ['schedule', 'speakers', 'rooms/1', null]) {
			for (const room of [{ id: 2 }, undefined]) {
				test(`${component}: ${area}, previous=${previous}, room=${room?.id} goes to Overview`, () => {
					const destinations = []
					const onBack = runInNewContext(`({${handler[0]}}).onBack`, {
						window: { eventyay, history: { state: previous ? { back: previous } : null } },
					})
					onBack.call({
						room,
						$router: {
							push: ({ name }) => destinations.push(name),
							replace: ({ name }) => destinations.push(name),
							back: () => assert.fail('Back to Overview must not follow browser history'),
						},
					})
					assert.deepEqual(destinations, [expected])
				})
			}
		}
	}
}
