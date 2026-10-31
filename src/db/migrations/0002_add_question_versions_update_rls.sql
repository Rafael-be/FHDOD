CREATE POLICY fhdod_api_question_versions_update
ON public.question_versions
FOR UPDATE TO fhdod_api
USING (true)
WITH CHECK (true);
