using System;
using System.Collections.Generic;

namespace Example
{
    public interface IGreetable
    {
        string Greet();
    }

    public enum Status
    {
        Active,
        Inactive
    }

    public class UserService : BaseService, IGreetable
    {
        private string _name;

        public UserService(string name)
        {
            _name = name;
        }

        public string GetName()
        {
            return _name;
        }

        public string Greet()
        {
            return "Hello, " + GetName();
        }

        public string Classify(int x)
        {
            if (x > 0)
            {
                return "positive";
            }
            else if (x < 0)
            {
                return "negative";
            }
            return "zero";
        }
    }

    public class UserServiceTests
    {
        [Fact]
        public void TestGetName()
        {
            var svc = new UserService("test");
            Assert.Equal("test", svc.GetName());
        }
    }
}
