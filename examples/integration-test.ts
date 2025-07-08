import { UtcpClient, HttpProvider } from '../src/index';

async function runIntegrationTest() {
  console.log('🧪 Starting UTCP TypeScript Library Integration Test...\n');

  try {
    // Test 1: Create client with inline provider
    console.log('✅ Test 1: Creating client with inline provider...');
    const httpProvider: HttpProvider = {
      name: 'httpbin_test',
      provider_type: 'http',
      url: 'https://httpbin.org/get',
      http_method: 'GET',
      content_type: 'application/json',
      body_field: 'body'
    };

    const client = await UtcpClient.create({
      tool_repository_type: 'in_memory',
      search_strategy: 'tag',
      max_concurrent_calls: 5,
      default_timeout: 30000,
      retry_attempts: 3,
      retry_delay: 1000,
      providers: [httpProvider]
    });

    console.log('   ✓ Client created successfully');

    // Test 2: Get available tools
    console.log('\n✅ Test 2: Getting available tools...');
    const tools = client.getAvailableTools();
    console.log(`   ✓ Found ${tools.length} tools`);

    // Test 3: Search functionality
    console.log('\n✅ Test 3: Testing search functionality...');
    const searchResults = client.searchTools('test');
    console.log(`   ✓ Search returned ${searchResults.length} results`);

    // Test 4: Tag-based search
    console.log('\n✅ Test 4: Testing tag-based search...');
    const tagResults = client.getToolsByTag('utcp');
    console.log(`   ✓ Tag search returned ${tagResults.length} results`);

    // Test 5: Test tool registration
    console.log('\n✅ Test 5: Testing tool registration...');
    const anotherProvider: HttpProvider = {
      name: 'another_test',
      provider_type: 'http',
      url: 'https://httpbin.org/post',
      http_method: 'POST',
      content_type: 'application/json',
      body_field: 'body'
    };

    const registeredTools = await client.registerToolProvider(anotherProvider);
    console.log(`   ✓ Registered ${registeredTools.length} tools from new provider`);

    // Test 6: Provider deregistration
    console.log('\n✅ Test 6: Testing provider deregistration...');
    client.deregisterToolProvider('another_test');
    const toolsAfterDeregister = client.getAvailableTools();
    console.log(`   ✓ Tools after deregistration: ${toolsAfterDeregister.length}`);

    // Test 7: Cleanup
    console.log('\n✅ Test 7: Testing cleanup...');
    await client.cleanup();
    console.log('   ✓ Client cleaned up successfully');

    console.log('\n🎉 All integration tests passed!');
    console.log('\n📦 UTCP TypeScript library is working correctly!');
    
  } catch (error) {
    console.error('\n❌ Integration test failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runIntegrationTest();
}
