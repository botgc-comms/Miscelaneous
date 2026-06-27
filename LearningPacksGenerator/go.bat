$env:OPENAI_API_KEY = [System.Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
echo $env:OPENAI_API_KEY
npx tsx .\generateLearningPacks.ts "C:\_src\BOTGC\Miscelaneous\LearningPacksGenerator"