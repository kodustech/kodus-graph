class UserService
  def initialize(name)
    @name = name
  end

  def classify(x)
    if x > 0
      'positive'
    elsif x < 0
      'negative'
    else
      'zero'
    end
  end

  def process(items)
    results = []
    items.each do |item|
      case item
      when String
        results << item.upcase
      when Integer
        results << item.to_s
      else
        results << item.inspect
      end
    end
    results
  end
end

def helper(value)
  value ? value * 2 : 0
end
