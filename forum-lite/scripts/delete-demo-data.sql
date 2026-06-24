-- Remove Turkish demo seed data from the live D1 database.
-- Reassign any imported legacy content that used demo users as fallback first.

UPDATE threads
SET user_id = (SELECT id FROM users WHERE username = 'ufukayyildiz')
WHERE public_id NOT IN ('160616','208887','257158','305429','353700','401971')
  AND user_id IN (SELECT id FROM users WHERE public_id IN ('194358','264035','333712','403389','473066') OR public_id LIKE '10000000000%')
  AND EXISTS (SELECT 1 FROM users WHERE username = 'ufukayyildiz');

UPDATE posts
SET user_id = (SELECT id FROM users WHERE username = 'ufukayyildiz')
WHERE thread_id NOT IN (SELECT id FROM threads WHERE public_id IN ('160616','208887','257158','305429','353700','401971') OR public_id LIKE '40000000000%')
  AND user_id IN (SELECT id FROM users WHERE public_id IN ('194358','264035','333712','403389','473066') OR public_id LIKE '10000000000%')
  AND EXISTS (SELECT 1 FROM users WHERE username = 'ufukayyildiz');

DELETE FROM likes
WHERE post_id IN (
  SELECT posts.id
  FROM posts
  INNER JOIN threads ON threads.id = posts.thread_id
  WHERE threads.public_id IN ('160616','208887','257158','305429','353700','401971') OR threads.public_id LIKE '40000000000%'
)
OR user_id IN (SELECT id FROM users WHERE public_id IN ('194358','264035','333712','403389','473066') OR public_id LIKE '10000000000%');

DELETE FROM thread_tags
WHERE thread_id IN (SELECT id FROM threads WHERE public_id IN ('160616','208887','257158','305429','353700','401971') OR public_id LIKE '40000000000%');

DELETE FROM posts
WHERE thread_id IN (SELECT id FROM threads WHERE public_id IN ('160616','208887','257158','305429','353700','401971') OR public_id LIKE '40000000000%');

DELETE FROM threads
WHERE public_id IN ('160616','208887','257158','305429','353700','401971') OR public_id LIKE '40000000000%';

DELETE FROM categories
WHERE public_id IN ('9932','8851','7770','6689','5608') OR public_id LIKE '20000000000%';

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE public_id IN ('194358','264035','333712','403389','473066') OR public_id LIKE '10000000000%');

DELETE FROM attachments
WHERE user_id IN (SELECT id FROM users WHERE public_id IN ('194358','264035','333712','403389','473066') OR public_id LIKE '10000000000%');

DELETE FROM users
WHERE public_id IN ('194358','264035','333712','403389','473066') OR public_id LIKE '10000000000%';
